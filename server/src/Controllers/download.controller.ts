import { Hono } from 'hono';
import archiver, { ArchiverError } from 'archiver'; // เปิด esModuleInterop ใน tsconfig หรือใช้ import * as archiver
import * as path from 'path';
import { PassThrough } from 'stream';
import { listKeys, getObjectBuffer } from '../Models/minio.model';

export const downloadRouter = new Hono();

/**
 * ZIP ทั้งโฟลเดอร์จาก MinIO
 * GET /downloads/folder?prefix=form/         -> zip documents/form/*
 * GET /downloads/folder                       -> zip ทั้ง bucket documents/*
 */
downloadRouter.get('/downloads/folder', async (c) => {
  const bucket = 'documents';
  const prefix = (c.req.query('prefix') || '').trim(); // เช่น 'form/'

  // list keys ใต้ prefix
  const keys = await listKeys(bucket, prefix);
  if (!keys.length) {
    return c.json({ error: `No files under prefix "${prefix}"` }, 404);
  }

  const zipName = `download-${prefix ? prefix.replace(/[\\/]+/g,'_') : 'documents'}-${Date.now()}.zip`;
  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();

  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="${zipName}"`);

  archive.on('error', (err: ArchiverError | Error) => {
    console.error('archiver error:', err);
    passthrough.destroy(err);
  });

  archive.pipe(passthrough);

  for (const key of keys) {
    try {
      const buf = await getObjectBuffer(bucket, key); // ✅ ส่งเป็น Buffer ตัดปัญหา type
      // ตั้งชื่อภายใน ZIP ให้เป็น path relative จาก prefix
      const nameInZip = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
      archive.append(buf, { name: nameInZip || path.basename(key) });
    } catch (e) {
      const fname = path.basename(key);
      archive.append(Buffer.from(`ไม่สามารถอ่านไฟล์: ${bucket}/${key}\n`), { name: `ERROR_${fname}.txt` });
    }
  }

  archive.finalize();
  return new Response(passthrough as any);
});

/**
 * ZIP 2 ไฟล์ตามที่ต้องการ (ตัวอย่างจากคำถามเดิม)
 * GET /downloads/forms
 */
downloadRouter.get('/downloads/forms', async (c) => {
  const bucket = 'documents';
  const keys = [
    'form/ข้อตกลงการแบ่งปันข้อมูลส่วนบุคคล_API_EBS_DDCE.docx',
    'form/ข้อตกลงการแบ่งปันข้อมูลส่วนบุคคล_API_EBS_DDCE.pdf',
  ];

  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();

  c.header('Content-Type', 'application/zip');
  c.header('Content-Disposition', `attachment; filename="forms-${Date.now()}.zip"`);

  archive.on('error', (err: ArchiverError | Error) => {
    console.error('archiver error:', err);
    passthrough.destroy(err);
  });

  archive.pipe(passthrough);

  for (const key of keys) {
    try {
      const buf = await getObjectBuffer(bucket, key); // ✅ Buffer
      const nameInZip = path.basename(key);
      archive.append(buf, { name: nameInZip });
    } catch {
      const nameInZip = path.basename(key);
      archive.append(Buffer.from(`ไม่พบไฟล์ ${bucket}/${key}\n`), { name: `ERROR_${nameInZip}.txt` });
    }
  }

  archive.finalize();
  return new Response(passthrough as any);
});
