import { db } from '../Config/mysql';
import { sql } from 'drizzle-orm';

// mapping source → table
const TABLE_MAP = {
  ebs: 'ebs_ddc_api',
  ebs_prov: 'ebs_prov_api',
} as const;

const ORDER_ALLOWLIST = new Set([
  'event_id',
  'event_notifier_date',
  'disease_name',
  'disease_group',
  'province_id',
]);

function rowsOf<T = any>(res: any): T[] {
  if (res && Array.isArray(res.rows)) return res.rows as T[];
  if (Array.isArray(res)) return (res[0] ?? []) as T[];
  return (res as T[]) ?? [];
}

export async function findEbs(params: {
  source: string;
  filters: {
    event_id?: string;
    disease_group?: string;
    event_notifier_date?: string;
    event_notifier_year?: string;
    province_id?: string;
  };
  page: number;
  pageSize: number;
  order_by?: string;
  order_dir?: string;
}) {
  const source = (params.source || 'ebs').toLowerCase() as keyof typeof TABLE_MAP;
  const table = TABLE_MAP[source];
  if (!table) throw new Error('invalid source (use ebs or ebs_prov)');

  const { event_id, disease_group, event_notifier_date, event_notifier_year, province_id } =
    params.filters;

  const page = Math.max(1, params.page);
  const pageSize = Math.min(200, Math.max(1, params.pageSize));
  const offset = (page - 1) * pageSize;

  let orderBy = 'event_notifier_date';
  if (params.order_by && ORDER_ALLOWLIST.has(params.order_by)) orderBy = params.order_by;
  const orderBySql = sql.raw(orderBy);
  const orderDirSql =
    (params.order_dir || 'desc').toLowerCase() === 'asc' ? sql`ASC` : sql`DESC`;

  const wh: any[] = [];
  if (event_id) wh.push(sql`event_id = ${Number(event_id)}`);
  if (disease_group) wh.push(sql`disease_group = ${disease_group}`);
  if (event_notifier_date) wh.push(sql`event_notifier_date = ${event_notifier_date}`);
  if (event_notifier_year) wh.push(sql`YEAR(event_notifier_date) = ${Number(event_notifier_year)}`);
  if (province_id) wh.push(sql`province_id = ${province_id}`);

  const whereSql = wh.length ? sql`WHERE ${sql.join(wh, sql` AND `)}` : sql``;
  const tableSql = sql.raw('`' + table + '`');

  // 1) count
  const countRes = await db.execute<{ cnt: number }>(
    sql`SELECT COUNT(*) AS cnt FROM ${tableSql} ${whereSql}`
  );
  const countRows = rowsOf<{ cnt: number }>(countRes);
  const total = countRows[0]?.cnt ?? 0;

  // 2) data
  const dataRes = await db.execute(
    sql`
      SELECT *
      FROM ${tableSql}
      ${whereSql}
      ORDER BY ${orderBySql} ${orderDirSql}, event_id DESC
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
