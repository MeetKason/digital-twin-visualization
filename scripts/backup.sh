#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/../deploy"
backup_path="${1:?请提供新的备份目录绝对路径}"
[[ "$backup_path" = /* && ! -e "$backup_path" ]] || { printf '须提供尚不存在的绝对目录。\n' >&2; exit 1; }
command -v shasum >/dev/null
mkdir -p "$backup_path"
running_services=$(docker compose ps --status running --services)
resume=()
while IFS= read -r service; do
  case "$service" in web|core-api|worker) resume+=("$service");; esac
done <<< "$running_services"
resume_services() {
  if [[ ${#resume[@]} -gt 0 ]]; then docker compose start "${resume[@]}" >&2; fi
}
trap resume_services EXIT
# 暂停所有写入服务，确保数据库中的资源引用与文件字节来自同一时点。
if [[ ${#resume[@]} -gt 0 ]]; then docker compose stop "${resume[@]}" >&2; fi
docker compose exec -T postgres pg_dump -U dtv -d dtv -Fc > "$backup_path/database.dump"
docker compose run --rm --no-deps -T --entrypoint tar core-api -C /app/.data/files -czf - . > "$backup_path/files.tar.gz"
(cd "$backup_path" && shasum -a 256 database.dump files.tar.gz > SHA256SUMS)
printf '数据库与文件已一致备份至 %s\n' "$backup_path"
