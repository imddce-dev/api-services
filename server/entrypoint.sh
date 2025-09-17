#!/bin/sh
# entrypoint.sh

# ทำ migration แบบ non-interactive
bun drizzle-kit push --yes

# เริ่ม server
bun run src/index.ts
