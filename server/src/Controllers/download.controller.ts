// src/Controllers/download.controller.ts
import { Hono } from 'hono';
import { PassThrough } from 'stream';
import archiver, { ArchiverError } from 'archiver'; // ถ้าไม่เปิด esModuleInterop ให้ใช้: import * as archiver from 'archiver'
import * as path from 'path';
import { listKeys, getObjectBuffer } from '../Models/minio.model';

export const downloadRouter = new Hono();

function encodeRFC5987(v: string) {
  return encodeURIComponent(v).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A');
}

// ---------- ZIP โฟลเดอร์ ----------
downloadRouter.get('/downloads/folder', async (c) => {
  const bucket = 'documents';
  const prefix = (c.req.query('prefix') || '').trim(); // เช่น 'form/'
  const keys = await listKeys(bucket, prefix);
  if (!keys.length) return c.json({ error: `No files under prefix "${prefix}"` }, 404);

  const zipName = `download-${(prefix ? prefix.replace(/[\\/]+/g, '_') : 'documents')}-${Date.now()}.zip`;
  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${zipName}"; filename*=UTF-8''${encodeRFC5987(zipName)}`,
    'Content-Transfer-Encoding': 'binary',
    'Cache-Control': 'no-store',
  });

  archive.on('error', (err: ArchiverError | Error) => passthrough.destroy(err));
  archive.pipe(passthrough);

  for (const key of keys) {
    try {
      const buf = await getObjectBuffer(bucket, key);
      const nameInZip = prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
      archive.append(buf, { name: nameInZip || path.basename(key) });
    } catch {
      const fname = path.basename(key);
      archive.append(Buffer.from(`ไม่สามารถอ่านไฟล์: ${bucket}/${key}\n`), { name: `ERROR_${fname}.txt` });
    }
  }

  archive.finalize();
  return new Response(passthrough as any, { headers }); // ✅ ส่ง headers ตรงนี้
});

// ---------- ZIP 2 ไฟล์คงที่ ----------
downloadRouter.get('/downloads/forms', async (c) => {
  const bucket = 'documents';
  const keys = [
    'form/ข้อตกลงการแบ่งปันข้อมูลส่วนบุคคล_API_EBS_DDCE.docx',
    'form/ข้อตกลงการแบ่งปันข้อมูลส่วนบุคคล_API_EBS_DDCE.pdf',
  ];

  const zipName = `forms-${Date.now()}.zip`;
  const archive = archiver('zip', { zlib: { level: 9 } });
  const passthrough = new PassThrough();

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${zipName}"; filename*=UTF-8''${encodeRFC5987(zipName)}`,
    'Content-Transfer-Encoding': 'binary',
    'Cache-Control': 'no-store',
  });

  archive.on('error', (err: ArchiverError | Error) => passthrough.destroy(err));
  archive.pipe(passthrough);

  for (const key of keys) {
    try {
      const buf = await getObjectBuffer(bucket, key); // ✅ ใช้ Buffer ตลอด
      archive.append(buf, { name: path.basename(key) });
    } catch {
      const nameInZip = path.basename(key);
      archive.append(Buffer.from(`ไม่พบไฟล์ ${bucket}/${key}\n`), { name: `ERROR_${nameInZip}.txt` });
    }
  }

  archive.finalize();
  return new Response(passthrough as any, { headers }); // ✅ สำคัญ!
});
