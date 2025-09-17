# ใช้ Bun official image
FROM oven/bun:1.1.26 as base

WORKDIR /app

# ติดตั้ง mysql-client
RUN apt-get update && apt-get install -y default-mysql-client netcat && rm -rf /var/lib/apt/lists/*

# คัดลอกไฟล์ dependencies
COPY package.json bun.lock ./ 

# ติดตั้ง dependencies
RUN bun install

# คัดลอก source code ทั้งหมด
COPY . .

# คัดลอก entrypoint script
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Expose port ที่ backend ใช้
EXPOSE 8080

# ใช้ entrypoint script
CMD ["./entrypoint.sh"]
