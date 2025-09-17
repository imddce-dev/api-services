#!/bin/sh
# รอให้ MariaDB พร้อม
while ! nc -z mariadb 3306; do
  echo "Waiting for mariadb..."
  sleep 1
done

# ทำ migration แบบ non-interactive
bun drizzle-kit push --force

# เริ่ม server
bun run src/index.ts
