import { dbMEBS } from '../Config/mysql';
import { sql } from 'drizzle-orm';

type OrderBy = 'e.id' | 'e.report_in_date' | 'e.created_at';
const ORDER_ALLOWLIST = new Set<OrderBy>(['e.id', 'e.report_in_date', 'e.created_at']);

function rowsOf<T = any>(res: any): T[] {
  if (res && Array.isArray(res.rows)) return res.rows as T[];
  if (Array.isArray(res)) return (res[0] ?? []) as T[];
  return (res as T[]) ?? [];
}

export async function findMebs(params: {
  filters: {
    event_id?: string | number;
    report_in_date_from?: string; // 'YYYY-MM-DD'
    report_in_date_to?: string;   // 'YYYY-MM-DD'
    incident_class?: string;
    category?: string;
  };
  page: number;
  pageSize: number;
  order_by?: OrderBy;
  order_dir?: 'asc' | 'desc' | 'ASC' | 'DESC';
}) {
  const {
    event_id,
    report_in_date_from,
    report_in_date_to,
    incident_class,
    category,
  } = params.filters || ({} as any);

  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(params.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;

  const orderBy: OrderBy =
    params.order_by && ORDER_ALLOWLIST.has(params.order_by) ? params.order_by : 'e.created_at';
  const orderDir = String(params.order_dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const wh: any[] = [sql`1 = 1`];
  if (event_id !== undefined)      wh.push(sql`e.id = ${Number(event_id)}`);
  if (report_in_date_from)         wh.push(sql`e.report_in_date >= ${report_in_date_from}`);
  if (report_in_date_to)           wh.push(sql`e.report_in_date <= ${report_in_date_to}`);
  if (incident_class)              wh.push(sql`e.incident_class = ${incident_class}`);
  if (category)                    wh.push(sql`e.category = ${category}`);

  const whereSql = sql.join(wh, sql` AND `);

  const countRes = await dbMEBS.execute<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM events e WHERE ${whereSql}`
  );
  const total = Number(rowsOf<{ total: number }>(countRes)[0]?.total ?? 0);

  const dataRes = await dbMEBS.execute(
    sql`
      SELECT
        e.id,
        e.incident_class,
        e.incident_specifications,
        e.category,
        e.type
      FROM events e
      WHERE ${whereSql}
      ${sql.raw(`ORDER BY ${orderBy} ${orderDir}`)}
      LIMIT ${pageSize} OFFSET ${offset}
    `
  );

  const items = rowsOf<any>(dataRes);

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  };
}
