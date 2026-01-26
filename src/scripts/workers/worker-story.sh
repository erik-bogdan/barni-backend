#!/usr/bin/env bash
set -euo pipefail
cd /opt/barni/backend

set -a
[ -f .env ] && source .env
set +a

echo "Starting story worker..."
exec /home/barni/.bun/bin/bun run worker