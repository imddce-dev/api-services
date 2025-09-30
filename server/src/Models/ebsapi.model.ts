// src/Models/ebsapi.model.ts
import { db } from '../Config/mysql';
import { sql } from 'drizzle-orm';
import type { Context } from 'hono';
import { PROVINCES_BY_GROUP, type OrgScope } from '../Config/org-scope';

// mapping source → table
const TABLE_MAP = { ebs: 'ebs_ddc_api', ebs_prov: 'ebs_prov_api' } as const;

const ORDER_ALLOWLIST = new Set([
  'event_id',
  'event_notifier_date',
  'disease_name',
  'disease_group',
  'province_id',
  'event_by_zone',
  'event_by_province',
]);

function rowsOf<T = any>(res: any): T[] {
  if (res && Array.isArray(res.rows)) return res.rows as T[];
  if (Array.isArray(res)) return (res[0] ?? []) as T[];
  return (res as T[]) ?? [];
}

export async function findEbs(params: {
  ctx?: Context; 
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
  const actor = params.ctx?.get('actor') as { scope?: OrgScope } | undefined;
  const scope = actor?.scope;

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
  const orderDirSql = (params.order_dir || 'desc').toLowerCase() === 'asc' ? sql`ASC` : sql`DESC`;

  // ---- WHERE เงื่อนไขจาก query ----
  const wh: any[] = [sql`1=1`];
  if (event_id)            wh.push(sql`event_id = ${Number(event_id)}`);
  if (disease_group)       wh.push(sql`disease_group = ${disease_group}`);
  if (event_notifier_date) wh.push(sql`event_notifier_date = ${event_notifier_date}`);
  if (event_notifier_year) wh.push(sql`YEAR(event_notifier_date) = ${Number(event_notifier_year)}`);
  if (province_id)         wh.push(sql`province_id = ${province_id}`);

  // ---- 🔒 บังคับตาม scope จาก middleware ----
  if (scope) {
    if (scope.type === 'PROV') {
      // สสจ. (เช่น organizer=14 → province_id = 50)
      wh.push(sql`province_id = ${scope.provinceId}`);
    } else if (scope.type === 'ODPC') {
      const allowed = PROVINCES_BY_GROUP[scope.odpc] || [];
      if (!allowed.length) {
        return { items: [], total: 0, page, page_size: pageSize, total_pages: 0 };
      }
      wh.push(sql`province_id IN (${sql.join(allowed.map(Number))})`);
    } else if (scope.type === 'CENTRAL') {
      // เห็นทั้งหมด → ไม่เติมเงื่อนไขเพิ่ม
    } else if (scope.type === 'EXTERNAL') {
      // ภายนอก: ไม่บังคับจังหวัด แต่จะจำกัดคอลัมน์ตอน SELECT
    } else {
      // UNKNOWN → กันข้อมูลรั่ว
      return { items: [], total: 0, page, page_size: pageSize, total_pages: 0 };
    }
  }

  const whereSql = sql`WHERE ${sql.join(wh, sql` AND `)}`;
  const tableSql = sql.raw('`' + table + '`');

  const externalColumns = [
    'event_id',
    'event_notifier_date',
    'disease_name',
    'disease_group',
    'province_id',
    'event_by_zone',
    'event_by_province',
  ];
  const selectSql =
    scope?.type === 'EXTERNAL'
      ? sql.raw(externalColumns.map(c => '`' + c + '`').join(', '))
      : sql.raw('*');

  // ---- COUNT ----
  const countRes = await db.execute<{ cnt: number }>(
    sql`SELECT COUNT(*) AS cnt FROM ${tableSql} ${whereSql}`
  );
  const countRows = rowsOf<{ cnt: number }>(countRes);
  const total = countRows[0]?.cnt ?? 0;

  // ---- DATA ----
  const dataRes = await db.execute(
    sql`
      SELECT ${selectSql}
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
