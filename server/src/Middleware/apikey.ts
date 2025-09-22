// src/Middleware/apikey.ts
import type { Context, Next } from 'hono';
import { sql } from 'drizzle-orm';
import { dbAPI } from '../Config/mysql';

type Options = {
  clientHeader?: string;
  secretHeader?: string;
  allowQueryParam?: boolean;
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
  const PASS_TTL = 60_000;
  const LIMIT_TTL = 60_000;
  const DEFAULT_LIMIT: LimitEntry = { prefix: '*', perMin: 120, burst: null };

  // ใช้ DB ตาม env (กันพลาด)
  const DB = process.env.DB_DATABASE_API || 'api_service_dev';
  const T_KEYS = sql.raw('`' + DB + '`.`api_keys`');
  const T_LIMITS = sql.raw('`' + DB + '`.`api_key_limits`');
  const T_IPS = sql.raw('`' + DB + '`.`api_key_ips`');

  function pickLimit(path: string, entries: LimitEntry[]): LimitEntry {
    let best: LimitEntry | null = null;
    for (const e of entries) {
      if (e.prefix === '*' || path.startsWith(e.prefix)) {
        if (!best || (e.prefix !== '*' && e.prefix.length > best.prefix.length)) best = e;
      }
    }
    return best || DEFAULT_LIMIT;
  }

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
    if (!rows.length) return [DEFAULT_LIMIT];
    return rows.map((x: any) => ({
      prefix: String(x.route_prefix || '*'),
      perMin: Number(x.per_min),
      burst:  x.burst != null ? Number(x.burst) : null
    }));
  }

  async function ipAllowed(apiKeyId: number, ip: string): Promise<boolean> {
    const rules: any[] = await dbAPI.execute(
      sql`SELECT ip_pattern FROM ${T_IPS} WHERE api_key_id = ${apiKeyId}`
    ).then((r: any) => Array.isArray(r.rows) ? r.rows : (r[0] ?? []));
    if (!rules.length) return true;
    return rules.some((r: any) => {
      const pat = String(r.ip_pattern);
      if (pat.endsWith('%')) return ip.startsWith(pat.slice(0, -1));
      return ip === pat;
    });
  }

  return async (c: Context, next: Next) => {
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

    // 1) ตรวจคู่ client/secret + status + expiry (cache)
    let pass = passCache.get(cacheKey);
    if (!pass || pass.exp <= now) {
      const rows: any[] = await dbAPI.execute(
        sql`SELECT id, user_id, status, expires_at
            FROM ${T_KEYS}
            WHERE client_key = ${clientKey} AND secret_key = ${secretKey}
            LIMIT 1`
      ).then((r: any) => Array.isArray(r.rows) ? r.rows : (r[0] ?? []));
      const row = rows[0];
      if (!row)                        return c.json({ error: 'Invalid credential' }, 401);
      if (row.status !== 'active')     return c.json({ error: `Credential is ${row.status}` }, 403);
      if (new Date(row.expires_at).getTime() <= now) return c.json({ error: 'Credential expired' }, 403);

      pass = { id: Number(row.id), user_id: Number(row.user_id), exp: now + PASS_TTL };
      passCache.set(cacheKey, pass);

      // best-effort update
      dbAPI.execute(sql`UPDATE ${T_KEYS} SET last_used_at = NOW() WHERE id = ${pass.id}`).catch(() => {});
    }

    // 2) ตรวจ IP
    const ip = getClientIP(c);
    const ok = await ipAllowed(pass.id, ip);
    if (!ok) return c.json({ error: 'IP not allowed', ip }, 403);

    // 3) ลิมิต
    let lim = limitCache.get(pass.id);
    if (!lim || lim.exp <= now) {
      const entries = await loadLimits(pass.id);
      lim = { entries, exp: now + LIMIT_TTL };
      limitCache.set(pass.id, lim);
    }

    const policy = pickLimit(c.req.path, lim.entries);
    const hardLimit = policy.burst ? policy.perMin + policy.burst : policy.perMin;

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

    c.header('X-RateLimit-Limit', String(hardLimit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, hardLimit - counter.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil((resetAt - now) / 1000)));
    c.header('X-RateLimit-Policy', `${policy.prefix}:${policy.perMin}${policy.burst ? `+${policy.burst}` : ''}`);

    if (counter.count + 1 > hardLimit) return c.json({ error: 'Too Many Requests' }, 429);
    counter.count += 1;

    c.set('actor', { userId: pass.user_id, credentialId: pass.id, clientKey, ip });
    await next();
  };
}
