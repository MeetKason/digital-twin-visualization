#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../deploy"
backup_path="${1:?请提供备份目录绝对路径}"
[[ "$backup_path" = /* && -d "$backup_path" ]] || { printf '须提供备份目录绝对路径。\n' >&2; exit 1; }
if [[ "${CONFIRM_RESTORE:-}" != "yes" ]]; then
  printf '恢复会覆盖数据库和全部附件文件。先留存当前备份，再用 CONFIRM_RESTORE=yes 运行。\n' >&2
  exit 1
fi
(cd "$backup_path" && shasum -a 256 -c SHA256SUMS)
docker compose stop web core-api worker >&2
# Failure leaves applications stopped for inspection; never restart a partial restore.
docker compose exec -T postgres pg_restore -U dtv -d dtv --clean --if-exists --exit-on-error --single-transaction < "$backup_path/database.dump"
docker compose run --rm --no-deps -T --entrypoint sh core-api -c 'mkdir -p /app/.data/files; find /app/.data/files -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar -xzf - -C /app/.data/files' < "$backup_path/files.tar.gz"
printf '数据库与文件恢复完成，应用保持停止。检查配置后运行 docker compose start core-api worker web。\n'
