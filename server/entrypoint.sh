#!/bin/sh
# entrypoint.sh

# รอให้ MariaDB พร้อมก่อน
until mysqladmin ping -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" --silent; do
  echo "Waiting for mariadb..."
  sleep 2
done

# ❌ ห้ามใช้ push แบบลบตาราง
# bun drizzle-kit push

# ✅ ใช้ incremental migration แทน (ถ้ามี)
bun drizzle-kit migrate

# เริ่ม server
bun run src/index.ts
