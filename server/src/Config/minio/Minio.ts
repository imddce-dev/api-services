import { Client } from 'minio'

export const minioClient = new Client({
  endPoint: '192.168.130.10',  // IP ของ MinIO server
  port: 9000,
  useSSL: false,              // true ถ้า MinIO ใช้ HTTPS
  accessKey: 'admin',
  secretKey: 'g0Uc;;myogs96dkiIN'
})
