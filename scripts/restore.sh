#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../deploy"
backup_path="${1:?请提供备份文件绝对路径}"
if [[ "${CONFIRM_RESTORE:-}" != "yes" ]]; then
  printf '恢复会覆盖当前数据库。停止应用并备份后，使用 CONFIRM_RESTORE=yes 再运行。\n' >&2
  exit 1
fi
docker compose exec -T postgres pg_restore -U dtv -d dtv --clean --if-exists < "$backup_path"
