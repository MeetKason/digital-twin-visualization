#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
compose=(docker compose -f "${COMPOSE_FILE:-$repo/deploy/compose.yaml}")
"${compose[@]}" stop web core-api worker
for migration in "$repo"/deploy/migrations/[0-9]*.sql; do
  [ -f "$migration" ] || continue
  echo "Applying $(basename "$migration")"
  "${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-dtv}" -d "${POSTGRES_DB:-dtv}" < "$migration"
done
echo "迁移完成。请确认备份和迁移输出后，再手动启动应用服务。"
