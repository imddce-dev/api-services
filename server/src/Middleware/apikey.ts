// src/Middleware/apikey.ts
import type { Context, Next } from 'hono';
import { sql } from 'drizzle-orm';
import { dbAPI } from '../Config/mysql';
import { resolveScope } from '../Config/org-scope';

type Options = {
  clientHeader?: string;      // header ชื่อ client key (default: x-client-key)
  secretHeader?: string;      // header ชื่อ secret key (default: x-secret-key)
  allowQueryParam?: boolean;  // อนุญาตอ่านจาก query string ?client_key & ?secret_key
};

type PassCache = { id: number; user_id: number; exp: number };
type LimitEntry = { prefix: string; perMin: number; burst?: number | null };
type LimitCache = { entries: LimitEntry[]; exp: number };
type Counter = { count: number; resetAt: number };

export function apiKeyAuth(opts: Options = {}) {
  const clientHeader = opts.clientHeader || 'x-client-key';
  const secretHeader = opts.secretHeader || 'x-secret-key';
  const allowQueryParam = opts.allowQueryParam ?? false;

  const passCache = new Map<string, PassCache>();
  const limitCache = new Map<number, LimitCache>();
  const counters = new Map<string, Counter>();

  const PASS_TTL = 60_000;   // 1 นาที
  const LIMIT_TTL = 60_000;  // 1 นาที

  // ใช้ schema ตาม .env
  const DB = process.env.DB_DATABASE_API || 'api_service_dev';
  const T_KEYS   = sql.raw('`' + DB + '`.`api_keys`');
  const T_LIMITS = sql.raw('`' + DB + '`.`api_key_limits`');
  const T_IPS    = sql.raw('`' + DB + '`.`api_key_ips`');
  const T_USERS  = sql.raw('`' + DB + '`.`users`');

  const getClientIP = (c: Context) => {
    const xf = c.req.header('x-forwarded-for'); if (xf) return xf.split(',')[0].trim();
    const xr = c.req.header('x-real-ip');       if (xr) return xr.trim();
    return '0.0.0.0';
  };

  async function loadLimits(apiKeyId: number): Promise<LimitEntry[]> {
    const rows:any[] = await dbAPI.execute(
      sql`SELECT route_prefix, per_min, burst FROM ${T_LIMITS} WHERE api_key_id = ${apiKeyId}`
    ).then((r:any)=> Array.isArray(r.rows)? r.rows : (r[0] ?? []));
    return rows.map((x:any)=>({
      prefix: String(x.route_prefix || '*'),
      perMin: Number(x.per_min),
      burst:  x.burst != null ? Number(x.burst) : null
    }));
  }

  async function ipAllowed(apiKeyId: number, ip: string) {
    const rules:any[] = await dbAPI.execute(
      sql`SELECT ip_pattern FROM ${T_IPS} WHERE api_key_id = ${apiKeyId}`
    ).then((r:any)=> Array.isArray(r.rows)? r.rows : (r[0] ?? []));
    if (!rules.length) return true; // ไม่ตั้ง whitelist → allow ทั้งหมด
    return rules.some((r:any) => {
      const pat = String(r.ip_pattern || '');
      return pat.endsWith('%') ? ip.startsWith(pat.slice(0, -1)) : (ip === pat);
    });
  }

  return async (c: Context, next: Next) => {
    // 1) รับคีย์จาก header (และ query ถ้าอนุญาต)
    let clientKey = c.req.header(clientHeader) || '';
    let secretKey = c.req.header(secretHeader) || '';
    if (allowQueryParam) {
      const q = c.req.query();
      clientKey ||= q.client_key || '';
      secretKey ||= q.secret_key || '';
    }
    if (!clientKey || !secretKey) {
      return c.json({ error: 'Missing client_key or secret_key' }, 401);
    }

    const now = Date.now();
    const cacheKey = `${clientKey}:${secretKey}`;

    // 2) ตรวจ credential (cache + DB), กรอง numeric status=1, ตรวจวันหมดอายุ
    let pass = passCache.get(cacheKey);
    if (!pass || pass.exp <= now) {
      const rows:any[] = await dbAPI.execute(
        sql`SELECT id, user_id, status, expires_at
            FROM ${T_KEYS}
            WHERE client_key = ${clientKey} AND secret_key = ${secretKey}
            LIMIT 1`
      ).then((r:any)=> Array.isArray(r.rows)? r.rows : (r[0] ?? []));
      const row = rows[0];
      if (!row) return c.json({ error: 'Invalid credential' }, 401);
      if (Number(row.status) !== 1) return c.json({ error: 'Credential inactive' }, 403);

      const expAt = new Date(row.expires_at).getTime();
      if (!(expAt > now)) return c.json({ error: 'Credential expired' }, 403);

      pass = { id: Number(row.id), user_id: Number(row.user_id), exp: now + PASS_TTL };
      passCache.set(cacheKey, pass);

      // best-effort update
      dbAPI.execute(sql`UPDATE ${T_KEYS} SET last_used_at = NOW() WHERE id = ${pass.id}`).catch(()=>{});
    }

    // 3) เช็ก IP whitelist
    const ip = getClientIP(c);
    if (!(await ipAllowed(pass.id, ip))) {
      return c.json({ error: 'IP not allowed', ip }, 403);
    }

    // 4) โหลด/แคช rate-limit แล้วเลือก policy (deny-by-default)
    let lim = limitCache.get(pass.id);
    if (!lim || lim.exp <= now) {
      const entries = await loadLimits(pass.id);
      lim = { entries, exp: now + LIMIT_TTL };
      limitCache.set(pass.id, lim);
    }

    const entries = lim.entries; // อาจ [] ได้ → deny-by-default
    let policy: LimitEntry | null = null;
    for (const e of entries) {
      if (e.prefix !== '*'
        && (c.req.path === e.prefix || c.req.path.startsWith(e.prefix + '/'))) {
        if (!policy || e.prefix.length > policy.prefix.length) policy = e;
      }
    }
    if (!policy) {
      const star = entries.find(e => e.prefix === '*');
      if (!star) {
        return c.json({
          error: 'Route not allowed for this credential',
          path: c.req.path,
          allowed_prefixes: entries.map(e => e.prefix),
        }, 403);
      }
      policy = star;
    }

    const hardLimit = policy.burst ? policy.perMin + policy.burst : policy.perMin;

    // 5) fixed-window counter (ต่อคีย์+prefix)
    const windowSec = 60;
    const bucketStart = Math.floor(now/1000/windowSec) * windowSec;
    const resetAt = (bucketStart + windowSec) * 1000;

    const counterKey = `${pass.id}:${policy.prefix}:${bucketStart}`;
    let counter = counters.get(counterKey);
    if (!counter) {
      counter = { count: 0, resetAt };
      counters.set(counterKey, counter);
      setTimeout(() => counters.delete(counterKey), resetAt - now + 1500);
    }

    c.header('X-RateLimit-Limit', String(hardLimit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, hardLimit - counter.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil((resetAt - now) / 1000)));
    c.header('X-RateLimit-Policy', `${policy.prefix}:${policy.perMin}${policy.burst ? `+${policy.burst}` : ''}`);

    if (counter.count + 1 > hardLimit) return c.json({ error: 'Too Many Requests' }, 429);
    counter.count += 1;

    // 6) ดึง organizer แล้ว map → scope ด้วย resolveScope()
    const userRes:any[] = await dbAPI.execute(
      sql`SELECT organizer FROM ${T_USERS} WHERE id = ${pass.user_id} LIMIT 1`
    ).then((r:any)=> Array.isArray(r.rows)? r.rows : (r[0] ?? []));
    const organizer = userRes[0]?.organizer != null ? Number(userRes[0].organizer) : undefined;
    const scope = resolveScope(organizer);

    // 7) set actor ให้ controller/model ใช้บังคับ WHERE/SELECT
    c.set('actor', {
      userId: pass.user_id,
      credentialId: pass.id,
      clientKey,
      ip,
      organizer,
      scope, // ⬅️ สำคัญ
    });

    await next();
  };
}
