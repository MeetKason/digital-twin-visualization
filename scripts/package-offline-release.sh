#!/usr/bin/env bash
set -euo pipefail
version="${1:?用法: scripts/package-offline-release.sh VERSION OUTPUT_DIR}"
release_dir="${2:?用法: scripts/package-offline-release.sh VERSION OUTPUT_DIR}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || { echo "版本号格式错误" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$release_dir/deploy" "$release_dir/deploy/auth" "$release_dir/deploy/tianqing" "$release_dir/scripts"
mkdir -p "$release_dir/deploy/tianqing"
cp "$repo/deploy/compose.yaml" "$repo/deploy/config.json" "$release_dir/deploy/"
cp -R "$repo/deploy/migrations" "$release_dir/deploy/"
cp "$repo/deploy/auth/.gitkeep" "$release_dir/deploy/auth/"
cp "$repo/deploy/tianqing/sources.example.json" "$release_dir/deploy/tianqing/"
cp "$repo/deploy/.env.example" "$repo/deploy/README-offline.md" "$release_dir/deploy/"
cp "$repo/scripts/backup.sh" "$repo/scripts/restore.sh" "$repo/scripts/apply-migrations.sh" "$repo/scripts/export-images.sh" "$repo/scripts/create-account.mjs" "$release_dir/scripts/"
chmod +x "$release_dir/scripts/"*.sh
DTV_VERSION="$version" docker compose -f "$repo/deploy/compose.yaml" build
DTV_VERSION="$version" "$repo/scripts/export-images.sh" "$release_dir"
cat > "$release_dir/RELEASE.txt" <<EOF
Digital Twin Visualization 离线部署包
版本: $version
镜像: dtv-web:$version, dtv-server:$version, postgis/postgis:16-3.5
部署前请阅读 deploy/README-offline.md 并确认目标 CPU 架构。
EOF
(cd "$release_dir" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 shasum -a 256 > SHA256SUMS)
echo "离线包已生成：$release_dir"
