#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../deploy"
backup_path="${1:?请提供备份文件绝对路径}"
docker compose exec -T postgres pg_dump -U dtv -d dtv -Fc > "$backup_path"
printf '数据库已备份至 %s\n' "$backup_path"
