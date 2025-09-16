# ใช้ bun official image
FROM oven/bun:1.1.26 as base

WORKDIR /app

# คัดลอกไฟล์ dependencies
COPY package.json bun.lockb ./

# ติดตั้ง dependencies
RUN bun install

# คัดลอก source code ทั้งหมด
COPY . .

# Expose port ที่ backend ใช้
EXPOSE 8080

# รัน migration ก่อน start server
CMD ["sh", "-c", "bun drizzle-kit push && bun run start"]
