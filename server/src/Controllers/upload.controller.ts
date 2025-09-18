import { Hono } from 'hono';
import { minioClient } from '../Config/minio/Minio';
import * as path from 'path';

export const uploadRouter = new Hono();

uploadRouter.post('/upload', async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get('file') as any; // Bun File
    if (!file) return c.json({ error: 'No file provided' }, 400);

    // แยกชื่อกับนามสกุลออกมา
    const originalName = file.name || file.filename || 'upload';
    const ext = path.extname(originalName);        // เช่น ".docx"
    const base = path.basename(originalName, ext); // เช่น "testupload"

    // ต่อ timestamp กันซ้ำ
    const filename = `${base}-${Date.now()}${ext}`;

    const buffer = await file.arrayBuffer();
    const key = `file_uploads/${filename}`;
    
    await minioClient.putObject('documents', key, Buffer.from(buffer));

    // return c.json({ message: 'Upload successful', path: key });
    return c.json({ 
      message: 'Upload successful',
      path: key,
      filename // ส่งคืนชื่อไฟล์ด้วย
    });
  } catch (e: any) {
    return c.json({ error: e.message || 'Upload failed' }, 500);
  }
});
