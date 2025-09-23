// src/Middleware/apikey.ts
import type { Context, Next } from 'hono';
import { sql } from 'drizzle-orm';
import { dbAPI } from '../Config/mysql';

type Options = {
  clientHeader?: string;      // ชื่อ header ของ client_key
  secretHeader?: string;      // ชื่อ header ของ secret_key
  allowQueryParam?: boolean;  // อนุญาตอ่านจาก query string ?client_key&secret_key
};

type PassCache = { id: number; user_id: number; exp: number };
type LimitEntry = { prefix: string; perMin: number; burst?: number | null };
type LimitCache = { entries: LimitEntry[]; exp: number };
type Counter = { count: number; resetAt: number };

export function apiKeyAuth(opts: Options = {}) {
  const clientHeader = opts.clientHeader || 'x-client-key';
  const secretHeader = opts.secretHeader || 'x-secret-key';
  const allowQueryParam = opts.allowQueryParam ?? false;

  const passCache = new Map<string, PassCache>(); // `${clientKey}:${secretKey}` -> pass
  const limitCache = new Map<number, LimitCache>(); // api_key_id -> limits
  const counters = new Map<string, Counter>(); // `${id}:${prefix}:${bucketStart}` -> counter

  const PASS_TTL = 60_000;  // cache credential 1 นาที
  const LIMIT_TTL = 60_000; // cache limits 1 นาที

  // บังคับ schema ป้องกันยิงผิดฐาน
  const DB = process.env.DB_DATABASE_API || 'api_service_dev';
  const T_KEYS   = sql.raw('`' + DB + '`.`api_keys`');
  const T_LIMITS = sql.raw('`' + DB + '`.`api_key_limits`');
  const T_IPS    = sql.raw('`' + DB + '`.`api_key_ips`');

  function getClientIP(c: Context): string {
    const xf = c.req.header('x-forwarded-for');
    if (xf) return xf.split(',')[0].trim();
    const xr = c.req.header('x-real-ip');
    if (xr) return xr.trim();
    return '0.0.0.0';
  }

  async function loadLimits(apiKeyId: number): Promise<LimitEntry[]> {
    const rows: any[] = await dbAPI.execute(
      sql`SELECT route_prefix, per_min, burst FROM ${T_LIMITS} WHERE api_key_id = ${apiKeyId}`
    ).then((r: any) => Array.isArray(r.rows) ? r.rows : (r[0] ?? []));
    // ❗ deny-by-default: ถ้าไม่มีแถว limit เลย => ไม่อนุญาตสัก route
    return rows.map((x: any) => ({
      prefix: String(x.route_prefix || '*'),
      perMin: Number(x.per_min),
      burst:  x.burst != null ? Number(x.burst) : null,
    }));
  }

  async function ipAllowed(apiKeyId: number, ip: string): Promise<boolean> {
    const rules: any[] = await dbAPI.execute(
      sql`SELECT ip_pattern FROM ${T_IPS} WHERE api_key_id = ${apiKeyId}`
    ).then((r: any) => Array.isArray(r.rows) ? r.rows : (r[0] ?? []));
    if (!rules.length) return true; // ถ้าไม่ตั้ง whitelist ให้ผ่านทั้งหมด
    return rules.some((r: any) => {
      const pat = String(r.ip_pattern);
      if (pat.endsWith('%')) return ip.startsWith(pat.slice(0, -1)); // prefix wildcard
      return ip === pat; // exact match
    });
  }

  return async (c: Context, next: Next) => {
    // --- รับคีย์ ---
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

    const cacheKey = `${clientKey}:${secretKey}`;
    const now = Date.now();

    // --- ตรวจ credential (cache + DB) ---
    let pass = passCache.get(cacheKey);
    if (!pass || pass.exp <= now) {
      const rows: any[] = await dbAPI.execute(
        sql`SELECT id, user_id, status, expires_at
            FROM ${T_KEYS}
            WHERE client_key = ${clientKey} AND secret_key = ${secretKey}
            LIMIT 1`
      ).then((r: any) => Array.isArray(r.rows) ? r.rows : (r[0] ?? []));
      const row = rows[0];
      if (!row) return c.json({ error: 'Invalid credential' }, 401);
      if (row.status !== 'active') return c.json({ error: `Credential is ${row.status}` }, 403);
      if (new Date(row.expires_at).getTime() <= now) return c.json({ error: 'Credential expired' }, 403);

      pass = { id: Number(row.id), user_id: Number(row.user_id), exp: now + PASS_TTL };
      passCache.set(cacheKey, pass);

      // best-effort update (ไม่ block request)
      dbAPI.execute(sql`UPDATE ${T_KEYS} SET last_used_at = NOW() WHERE id = ${pass.id}`).catch(() => {});
    }

    // --- ตรวจ IP ---
    const ip = getClientIP(c);
    const ok = await ipAllowed(pass.id, ip);
    if (!ok) return c.json({ error: 'IP not allowed', ip }, 403);

    // --- โหลดลิมิต (cache) ---
    let lim = limitCache.get(pass.id);
    if (!lim || lim.exp <= now) {
      const entries = await loadLimits(pass.id);
      lim = { entries, exp: now + LIMIT_TTL };
      limitCache.set(pass.id, lim);
    }

    // --- เลือกนโยบายแบบ deny-by-default ---
    const entries = lim.entries; // อาจเป็น [] ได้
    // match prefix ที่ยาวสุด (ไม่รวม '*')
    let policy: LimitEntry | null = null;
    for (const e of entries) {
      if (e.prefix !== '*') {
        if (c.req.path === e.prefix || c.req.path.startsWith(e.prefix + '/')) {
          if (!policy || e.prefix.length > policy.prefix.length) {
            policy = e;
          }
        }
      }
    }
    // ถ้าไม่เจอ prefix ใดเลย → ใช้ '*' ก็ต่อเมื่อมีตั้งไว้เท่านั้น
    if (!policy) {
      const star = entries.find(e => e.prefix === '*');
      if (star) {
        policy = star;
      } else {
        return c.json({
          error: 'Route not allowed for this credential',
          path: c.req.path,
          allowed_prefixes: entries.map(e => e.prefix),
        }, 403);
      }
    }

    const hardLimit = policy.burst ? policy.perMin + policy.burst : policy.perMin;

    // --- Fixed window counter (ต่อคีย์ + prefix) ---
    const windowSec = 60;
    const bucketStart = Math.floor(now / 1000 / windowSec) * windowSec;
    const resetAt = (bucketStart + windowSec) * 1000;

    const counterKey = `${pass.id}:${policy.prefix}:${bucketStart}`;
    let counter = counters.get(counterKey);
    if (!counter) {
      counter = { count: 0, resetAt };
      counters.set(counterKey, counter);
      setTimeout(() => counters.delete(counterKey), resetAt - now + 1500);
    }

    // Headers สำหรับ client
    c.header('X-RateLimit-Limit', String(hardLimit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, hardLimit - counter.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil((resetAt - now) / 1000)));
    c.header('X-RateLimit-Policy', `${policy.prefix}:${policy.perMin}${policy.burst ? `+${policy.burst}` : ''}`);

    if (counter.count + 1 > hardLimit) {
      return c.json({ error: 'Too Many Requests' }, 429);
    }
    counter.count += 1;

    // set actor ให้ downstream ใช้ต่อได้
    c.set('actor', { userId: pass.user_id, credentialId: pass.id, clientKey, ip });

    await next();
  };
}
