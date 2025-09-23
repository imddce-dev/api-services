import { minioClient } from '../Config/minio';

// list ไฟล์ทั้งหมดใต้ prefix (เช่น 'form/' หรือ '' เพื่อทั้ง bucket)
export async function listKeys(bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  // SDK MinIO รองรับ for-await-of
  // third arg 'true' = recursive
  const stream: any = minioClient.listObjectsV2(bucket, prefix, true);
  for await (const obj of stream as any) {
    if (obj?.name) out.push(obj.name as string);
  }
  return out;
}

// ดึงไฟล์เป็น Buffer (กันเรื่อง ReadableStream/Readable ชนกัน)
export async function getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
  const obj: any = await minioClient.getObject(bucket, key);

  // Node stream: มี .pipe/.on
  if (obj && typeof obj.pipe === 'function') {
    const chunks: Buffer[] = [];
    return await new Promise<Buffer>((resolve, reject) => {
      obj.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      obj.on('end', () => resolve(Buffer.concat(chunks)));
      obj.on('error', reject);
    });
  }

  // Web ReadableStream: มี .getReader()
  if (obj && typeof obj.getReader === 'function') {
    const reader = obj.getReader();
    const bufs: Buffer[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) bufs.push(Buffer.from(value));
    }
    return Buffer.concat(bufs);
  }

  // ถ้าเป็น Response-like
  if (obj && typeof obj.arrayBuffer === 'function') {
    const ab = await obj.arrayBuffer();
    return Buffer.from(ab);
  }

  throw new Error(`Unsupported stream type for ${bucket}/${key}`);
}
