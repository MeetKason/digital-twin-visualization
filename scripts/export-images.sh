#!/usr/bin/env bash
set -euo pipefail
release_dir="${1:?请提供离线包目录}"
mkdir -p "$release_dir"
docker save dtv-web:0.1.0 dtv-server:0.1.0 postgis/postgis:16-3.5 -o "$release_dir/images.tar"
shasum -a 256 "$release_dir/images.tar" > "$release_dir/images.sha256"
printf '将 deploy 目录与此镜像归档一起交付；目标机 docker load -i images.tar 后 compose up -d，禁止 --build。\n'
