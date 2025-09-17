#!/bin/sh
# entrypoint.sh

# ทำ migration แบบ non-interactive ด้วย --force
bun drizzle-kit push --force

# เริ่ม server
bun run src/index.ts
