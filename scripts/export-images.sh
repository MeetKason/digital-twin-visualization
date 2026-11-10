#!/usr/bin/env bash
set -euo pipefail
version="${DTV_VERSION:-0.3.0}"
release_dir="${1:?请提供离线包目录}"
mkdir -p "$release_dir"
docker save "dtv-web:$version" "dtv-server:$version" postgis/postgis:16-3.5 -o "$release_dir/images.tar"
shasum -a 256 "$release_dir/images.tar" > "$release_dir/images.sha256"
printf '镜像包已导出。目标机先执行 docker load -i images.tar，再用 --no-build --pull never 启动。\n'
