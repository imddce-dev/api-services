#!/bin/sh
# entrypoint.sh

# ทำ migration แบบ non-interactive
export DRIZZLE_NON_INTERACTIVE=1
bun drizzle-kit push

# เริ่ม server
bun run src/index.ts
