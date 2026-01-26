#!/usr/bin/env bash
set -euo pipefail
cd /opt/barni/backend

# .env betöltés (dotenv nélkül)
set -a
[ -f .env ] && source .env
set +a

echo "Starting audio worker..."
exec /home/barni/.bun/bin/bun run worker:audio