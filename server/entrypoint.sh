#!/bin/sh
# entrypoint.sh

# รอให้ MariaDB พร้อมก่อน
until mysqladmin ping -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" --silent; do
  echo "Waiting for mariadb..."
  sleep 2
done

# ทำ migration แบบ non-interactive ด้วย --force
bun drizzle-kit push --force

# เริ่ม server
bun run src/index.ts
