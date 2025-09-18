import { Hono } from 'hono';
import { minioClient } from '../Config/minio/Minio';

export const uploadRouter = new Hono();

uploadRouter.post('/', async (c) => {
  try {
    const form = await c.req.formData();
    const file = form.get('file') as any; // Bun File
    if (!file) return c.json({ error: 'No file provided' }, 400);

    const filename = file.filename || 'unknown';
    const buffer = await file.arrayBuffer();
    const key = `file_uploads/${filename}`;
    
    await minioClient.putObject('documents', key, Buffer.from(buffer));

    return c.json({ message: 'Upload successful', path: key });
  } catch (e: any) {
    return c.json({ error: e.message || 'Upload failed' }, 500);
  }
});
