import { Hono } from 'hono';
import { findEbs } from '../Models/ebsapi.model';
import { minioClient } from '../Config/minio/Minio';

const BUCKET_MAP = {
  ebs: 'fileebs',
  ebs_prov: 'fileebsprov',
} as const;

export const ebsRouter = new Hono();

// GET /api/v1/:source
// ตัวอย่าง: /api/v1/ebs?event_id=2
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

    const bucket = BUCKET_MAP[source as keyof typeof BUCKET_MAP];

    // สร้าง signed URL สำหรับแต่ละ item ตาม path ใน DB
    for (const item of res.items) {
      // สมมติ DB เก็บ path ไว้ใน field เช่น item.AAAS
      const filePath: string = item.AAAS; 
      if (filePath) {
        // แยก folder กับ filename
        const parts = filePath.replace(/^\/+/, '').split('/');
        const folder = parts[0];              // file_uploads / excel / images
        const filename = parts.slice(1).join('/'); // filename จริง

        try {
          item.file_url = await minioClient.presignedUrl(
            'GET',
            bucket,
            `${folder}/${filename}`,
            300 // 5 นาที
          );
        } catch {
          item.file_url = null;
        }
      } else {
        item.file_url = null;
      }
    }

    return c.json(res);
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'query failed' }, 400);
  }
});

// Endpoint สำหรับสร้าง signed URL แบบตรง ๆ
// GET /api/v1/files-url/:bucket/:folder/:filename
ebsRouter.get('/files-url/:bucket/:folder/:filename', async (c) => {
  try {
    const bucketParam = c.req.param('bucket');      // fileebs หรือ fileebsprov
    const folder = c.req.param('folder');          // file_uploads, excel, images
    const filename = decodeURIComponent(c.req.param('filename'));
    const key = `${folder}/${filename}`;

    // ตรวจสอบไฟล์
    const objects = await minioClient.listObjectsV2(bucketParam, `${folder}/`, true);
    const exists = await new Promise<boolean>((resolve) => {
      let found = false;
      objects.on('data', (obj) => { if (obj.name === key) found = true; });
      objects.on('end', () => resolve(found));
      objects.on('error', () => resolve(false));
    });

    if (!exists) return c.json({ error: 'file not found in bucket' }, 404);

    // สร้าง signed URL
    const url = await minioClient.presignedUrl('GET', bucketParam, key, 24 * 60 * 60); // 24 ชม.
    return c.json({ url });
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'error generating url' }, 500);
  }
});
