FROM oven/bun:1.1.26 as base

WORKDIR /app

# คัดลอกไฟล์ dependencies
COPY package.json bun.lock ./

RUN bun install

# คัดลอก source code ทั้งหมด
COPY . .

# copy entrypoint script
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 8080

# ใช้ entrypoint script
CMD ["./entrypoint.sh"]
