#!/usr/bin/env bash
set -euo pipefail
version="${1:?用法: scripts/package-offline-release.sh VERSION OUTPUT_DIR}"
release_dir="${2:?用法: scripts/package-offline-release.sh VERSION OUTPUT_DIR}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || { echo "版本号格式错误" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$release_dir/deploy" "$release_dir/deploy/auth" "$release_dir/deploy/tianqing" "$release_dir/scripts"
# 只交付公钥与无凭据模板，不复制现场账号、真实天擎配置或扩展令牌。
mkdir -p "$release_dir/deploy/licensing" "$release_dir/extensions" "$release_dir/sdk/packages" "$release_dir/sdk/scripts" "$release_dir/docs/examples"
cp "$repo/deploy/licensing/trust-roots.json" "$release_dir/deploy/licensing/"
cp -R "$repo/extensions/backend-template" "$release_dir/extensions/"
for package in sdk contracts plugins; do
  mkdir -p "$release_dir/sdk/packages/$package"
  cp "$repo/packages/$package/package.json" "$release_dir/sdk/packages/$package/"
  cp -R "$repo/packages/$package/src" "$release_dir/sdk/packages/$package/"
done
cp "$repo/packages/plugins/catalog.json" "$release_dir/sdk/packages/plugins/"
cp "$repo/scripts/license-tool.ts" "$release_dir/sdk/scripts/"
cp "$repo/docs/examples/tenant-license-payload.json" "$release_dir/docs/examples/"
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
