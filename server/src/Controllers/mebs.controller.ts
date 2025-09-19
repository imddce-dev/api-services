import { Hono } from 'hono';
import { findMebs } from '../Models/mebsapi.model';

export const mebsRouter = new Hono();

mebsRouter.get('/', async (c) => {
  try {
    const qs = c.req.query();

    const res = await findMebs({
      filters: {
        event_id: qs.event_id ? Number(qs.event_id) : undefined,
        report_in_date_from: qs.report_in_date_from,
        report_in_date_to: qs.report_in_date_to,
        incident_class: qs.incident_class,
        category: qs.category,
      },
      page: Number(qs.page ?? 1),
      pageSize: Number(qs.page_size ?? 50),
      order_by: qs.order_by as any,  
      order_dir: qs.order_dir as any,
    });

    return c.json(res);
  } catch (e: any) {
    console.error(e);
    return c.json({
      error: e.sqlMessage || e.message || 'query failed',
      code: e.code,
    }, 400);
  }
});
