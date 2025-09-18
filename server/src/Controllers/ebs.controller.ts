import { Hono } from 'hono';
import { findEbs } from '../Models/ebsapi.model';
import { minioClient } from '../Config/minio/Minio';

const BUCKET_MAP = {
  ebs: 'fileebs',
  ebs_prov: 'fileebsprov',
} as const;

// mapping folder ถ้า DB มี field file_type
const FOLDER_MAP = {
  attachment: 'file_uploads',
  excel: 'excel',
  image: 'images',
} as const;

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

    const bucket = BUCKET_MAP[source as keyof typeof BUCKET_MAP];

    // แก้ไขตรงนี้: เอา AAAS มาสร้าง URL
    for (const item of res.items) {
      const aaFiles = item.AAAS as string | undefined;
      if (aaFiles) {
        const files: string[] = aaFiles.split(',').map(f => f.trim()).filter(Boolean);
        const urls: (string | null)[] = [];

        for (const f of files) {
          // กำหนด folder ตามชื่อไฟล์
          let folder = 'file_uploads'; // default
          for (const key of Object.keys(FOLDER_MAP)) {
            if (f.includes(FOLDER_MAP[key as keyof typeof FOLDER_MAP])) {
              folder = FOLDER_MAP[key as keyof typeof FOLDER_MAP];
              break;
            }
          }

          let keyName = f.startsWith('/') ? f.slice(1) : f.startsWith(folder) ? f : `${folder}/${f}`;
          console.log('bucket:', bucket, 'keyName:', keyName);

          try {
            const url = await minioClient.presignedUrl('GET', bucket, keyName, 86400); // 1 วัน
            urls.push(url);
          } catch (err: any) {
            console.error('Error generating presignedUrl', err);
            urls.push(null);
          }
        }

        item.file_url = urls;
      } else {
        item.file_url = [];
      }
    }

    return c.json(res);
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'query failed' }, 400);
  }
});

// Endpoint สำหรับดาวน์โหลดไฟล์ตรง ๆ
ebsRouter.get('/files-url/:bucket/:folder/:filename', async (c) => {
  try {
    const bucket = c.req.param('bucket');
    const folder = c.req.param('folder');
    const filename = decodeURIComponent(c.req.param('filename'));
    const key = `${folder}/${filename}`;

    try {
      await minioClient.statObject(bucket, key);
    } catch {
      return c.json({ error: 'file not found in bucket' }, 404);
    }

    const url = await minioClient.presignedUrl('GET', bucket, key, 86400);
    return c.json({ url });
  } catch (e: any) {
    return c.json({ error: e?.message ?? 'error generating url' }, 500);
  }
});
