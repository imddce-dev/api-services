import { Hono } from 'hono';
import { minioClient } from '../Config/minio';
import * as path from 'path';

export const uploadRouter = new Hono();

uploadRouter.post('/upload', async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get('file') as any; // Bun File
    if (!file) return c.json({ error: 'No file provided' }, 400);

    // เอาชื่อไฟล์เดิมมาก่อน
    const originalName = file.name || file.filename || 'upload';
    let ext = path.extname(originalName);

    // fallback ถ้าไม่มีนามสกุล ให้เดาจาก mimetype
    if (!ext && file.type) {
      if (file.type.includes('wordprocessingml')) ext = '.docx';
      else if (file.type === 'application/pdf') ext = '.pdf';
      else if (file.type.startsWith('image/')) ext = '.' + file.type.split('/')[1];
    }

    const base = path.basename(originalName, ext) || 'upload';
    const filename = `${base}-${Date.now()}${ext}`;

    const buffer = await file.arrayBuffer();
    const key = `file_uploads/${filename}`;
    
    await minioClient.putObject('documents', key, Buffer.from(buffer));

    return c.json({ 
      message: 'Upload successful',
      path: key,
      filename
    });
  } catch (e: any) {
    return c.json({ error: e.message || 'Upload failed' }, 500);
  }
});
