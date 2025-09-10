import { Hono } from 'hono';
import { findEbs } from '../Models/ebsapi.model';

export const ebsRouter = new Hono();

ebsRouter.get('/:source', async (c) => {
  try {
    const source = c.req.param('source') || 'ebs';
    const qs = c.req.query();

    const res = await findEbs({
      source,
      filters: {
        event_id: qs.event_id,
        disease_group: qs.disease_group,
        event_notifier_date: qs.event_notifier_date,
        event_notifier_year: qs.event_notifier_year,
        province_id: qs.province_id,
      },
      page: Number(qs.page ?? 1),
      pageSize: Number(qs.page_size ?? 50),
      order_by: qs.order_by,
      order_dir: qs.order_dir,
    });

    return c.json(res);
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'query failed' }, 400);
  }
});
