import { Client } from 'minio'

export const minioClient = new Client({
  endPoint: '192.168.110.7',  // IP ของ MinIO server
  port: 9000,
  useSSL: false,              // true ถ้า MinIO ใช้ HTTPS
  accessKey: 'api-key-hono',
  secretKey: 'g0Uc;;myogs96dkiIN'
})
