import { Client } from 'minio'

// export const minioClient = new Client({
//   endPoint: '192.168.130.10',  // IP ของ MinIO server
//   port: 9000,
//   useSSL: false,              // true ถ้า MinIO ใช้ HTTPS
//   accessKey: 'admin',
//   secretKey: 'g0Uc;;myogs96dkiIN'
// })
export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || '127.0.0.1',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: String(process.env.MINIO_USE_SSL).toLowerCase() === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || '',
  secretKey: process.env.MINIO_SECRET_KEY || '',
});

// helper: list bucket names จาก .env
export const MINIO_BUCKETS = (process.env.MINIO_BUCKETS || '')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);