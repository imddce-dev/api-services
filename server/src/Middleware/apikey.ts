import type { Context, Next } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../Config/mysql/index';

type Options = {
  headerName?: string;
  allowQueryParam?: boolean;
};

type PassCache = { api_key_id: number; user_id: number; exp: number };
type LimitEntry = { prefix: string; perMin: number; burst?: number | null };
type LimitCache = { entries: LimitEntry[]; exp: number };
type Counter = { count: number; resetAt: number };

export function apiKeyAuth(opts: Options = {}) {
  const headerName = opts.headerName || 'apikey';
  const allowQueryParam = opts.allowQueryParam ?? false;

  // cache
  const passCache = new Map<string, PassCache>();          // key → {api_key_id,user_id}
  const limitCache = new Map<number, LimitCache>();        // api_key_id → limits
  const counters   = new Map<string, Counter>();           // counterKey → counter
  const PASS_TTL  = 60_000;  // 1m
  const LIMIT_TTL = 60_000;  // 1m
  const DEFAULT_LIMIT: LimitEntry = { prefix: '*', perMin: 120, burst: null };

  function pickLimit(path: string, entries: LimitEntry[]): LimitEntry {
    // เลือก prefix ที่ “ยาวสุด” ที่ match path, ถ้าไม่เจอใช้ '*'
    let best: LimitEntry | null = null;
    for (const e of entries) {
      if (e.prefix === '*' || path.startsWith(e.prefix)) {
        if (!best || (e.prefix !== '*' && e.prefix.length > best.prefix.length)) best = e;
      }
    }
    return best || DEFAULT_LIMIT;
  }

  return async (c: Context, next: Next) => {
    // --- get key ---
    let key = c.req.header(headerName) || '';
    if (!key && allowQueryParam) key = c.req.query('apikey') || '';
    if (!key) return c.json({ error: 'Missing API key' }, 401);

    const now = Date.now();

    // --- auth pass cache / DB ---
    let pass = passCache.get(key);
    if (!pass || pass.exp <= now) {
      const rows: any[] = await db.execute(
        sql`SELECT id, user_id, status, expires_at
            FROM api_keys WHERE api_key = ${key} LIMIT 1`
      ).then((r: any) => Array.isArray(r.rows) ? r.rows : (r[0] ?? []));
      const row = rows[0];
      if (!row)                        return c.json({ error: 'Invalid API key' }, 401);
      if (row.status !== 'active')     return c.json({ error: `API key is ${row.status}` }, 403);
      if (new Date(row.expires_at).getTime() <= now) return c.json({ error: 'API key expired' }, 403);
      pass = { api_key_id: Number(row.id), user_id: Number(row.user_id), exp: now + PASS_TTL };
      passCache.set(key, pass);
    }

    // --- load per-route limits for this key ---
    let lim = limitCache.get(pass.api_key_id);
    if (!lim || lim.exp <= now) {
      const rows: any[] = await db.execute(
        sql`SELECT route_prefix, per_min, burst
            FROM api_key_limits WHERE api_key_id = ${pass.api_key_id}`
      ).then((r: any) => Array.isArray(r.rows) ? r.rows : (r[0] ?? []));
      const entries: LimitEntry[] = rows.length
        ? rows.map((x: any) => ({
            prefix: String(x.route_prefix || '*'),
            perMin: Number(x.per_min),
            burst:  x.burst != null ? Number(x.burst) : null
          }))
        : [DEFAULT_LIMIT];
      lim = { entries, exp: now + LIMIT_TTL };
      limitCache.set(pass.api_key_id, lim);
    }

    const path = c.req.path;
    const policy = pickLimit(path, lim.entries);
    const hardLimit = policy.burst ? policy.perMin + policy.burst : policy.perMin;

    // --- fixed window counter (per key + prefix) ---
    const windowSec = 60;
    const bucketStart = Math.floor(now / 1000 / windowSec) * windowSec; // เริ่มนาทีนี้ (epoch sec)
    const resetAt = (bucketStart + windowSec) * 1000;

    const counterKey = `${pass.api_key_id}:${policy.prefix}:${bucketStart}`;
    let counter = counters.get(counterKey);
    if (!counter) {
      counter = { count: 0, resetAt };
      counters.set(counterKey, counter);
      setTimeout(() => counters.delete(counterKey), resetAt - now + 1500); // เก็บถึงพ้น window นิดหน่อย
    }

    // headers ให้ client
    c.header('X-RateLimit-Limit', String(hardLimit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, hardLimit - counter.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil((resetAt - now) / 1000)));
    c.header('X-RateLimit-Policy', `${policy.prefix}:${policy.perMin}${policy.burst ? `+${policy.burst}` : ''}`);

    if (counter.count + 1 > hardLimit) {
      return c.json({ error: 'Too Many Requests' }, 429);
    }
    counter.count += 1;

    // set actor for downstream
    c.set('actor', { userId: pass.user_id, apiKeyId: pass.api_key_id, apiKey: key });

    await next();
  };
}