#!/usr/bin/env bash
set -Eeuo pipefail

# 只部署已提交且与远端分支完全一致的代码，避免把旧工作区误推到服务器。
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"
branch="$(git branch --show-current)"
if [[ -z "$branch" ]]; then
  echo "当前处于 detached HEAD，拒绝部署。" >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区不干净；请先提交并推送改动，再执行部署。" >&2
  exit 2
fi
git fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
commit="$(git rev-parse HEAD)"
remote_commit="$(git rev-parse "origin/$branch")"
if [[ "$commit" != "$remote_commit" ]]; then
  echo "本地 HEAD ($commit) 不是 origin/$branch 最新提交 ($remote_commit)，拒绝部署。" >&2
  exit 2
fi

ssh_target="${DTV_SSH_TARGET:-ubuntu@162.14.107.55}"
ssh_port="${DTV_SSH_PORT:-22}"
remote_dir="${DTV_REMOTE_DIR:-/home/ubuntu/dtv-visualization}"
compose_project="${DTV_COMPOSE_PROJECT_NAME:-dtv}"
health_url="${DTV_PUBLIC_HEALTH_URL:-http://162.14.107.55:18087}"
if [[ ! "$remote_dir" =~ ^/[A-Za-z0-9._/-]+$ || ! "$compose_project" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "远端目录或 Compose 项目名包含不支持的字符。" >&2
  exit 2
fi

echo "正在构建 origin/$branch 最新提交 $commit 的前端…"
npm run build -w @dtv/web
[[ -s apps/web/dist/index.html ]] || {
  echo "前端构建没有生成 index.html，拒绝部署。" >&2
  exit 1
}

# 使用已构建的 dist 制作 Nginx 镜像，不把本机 npm registry 凭据放进构建上下文。
build_context="$(mktemp -d "${TMPDIR:-/tmp}/dtv-web-deploy.XXXXXX")"
mkdir -p "$build_context/dist"
cp -R apps/web/dist/. "$build_context/dist/"
printf '{"commit":"%s"}\n' "$commit" > "$build_context/dist/deploy-version.json"
cp deploy/nginx.conf "$build_context/nginx.conf"
cat > "$build_context/Dockerfile" <<'DOCKERFILE'
FROM nginx:1.28-alpine
ARG DTV_COMMIT
LABEL org.opencontainers.image.revision="$DTV_COMMIT"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
DOCKERFILE
image_tag="dtv-web:$commit"
docker buildx build \
  --platform linux/amd64 \
  --build-arg "DTV_COMMIT=$commit" \
  --load \
  --tag "$image_tag" \
  --file "$build_context/Dockerfile" \
  "$build_context"

echo "正在将镜像 $image_tag 传输到 $ssh_target…"
docker save "$image_tag" | gzip -1 | ssh -p "$ssh_port" "$ssh_target" 'gunzip | docker load'

remote_script="/tmp/dtv-deploy-web-$commit.sh"
scp -P "$ssh_port" scripts/deploy-web-remote.sh "$ssh_target:$remote_script"
ssh -p "$ssh_port" "$ssh_target" \
  "DTV_REMOTE_DIR='$remote_dir' DTV_COMPOSE_PROJECT_NAME='$compose_project' bash '$remote_script' '$commit'"

echo "检查公网版本标识与健康状态…"
deployed_version="$(curl -fsS --max-time 10 "$health_url/deploy-version.json")"
if [[ "$deployed_version" != *"$commit"* ]] || ! curl -fsS --max-time 10 "$health_url/health" >/dev/null; then
  echo "公网版本核验失败，触发服务器自动回退。" >&2
  ssh -p "$ssh_port" "$ssh_target" \
    "DTV_REMOTE_DIR='$remote_dir' DTV_COMPOSE_PROJECT_NAME='$compose_project' bash '$remote_script' rollback '$commit'"
  exit 1
fi
ssh -p "$ssh_port" "$ssh_target" "unlink '$remote_script'" || true
echo "部署成功：$commit"
