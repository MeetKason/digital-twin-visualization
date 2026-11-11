#!/usr/bin/env bash
set -Eeuo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"; cd "$repo"
branch="$(git branch --show-current)"
[[ -n "$branch" && -z "$(git status --porcelain)" ]] || { echo '需使用已提交的干净功能分支部署' >&2; exit 2; }
git fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
commit="$(git rev-parse HEAD)"
[[ "$commit" == "$(git rev-parse "origin/$branch")" ]] || { echo '本地版本不是远端分支最新提交，拒绝部署' >&2; exit 2; }
target="${DTV_SSH_TARGET:-ubuntu@162.14.107.55}"; port="${DTV_SSH_PORT:-22}"
remote="${DTV_REMOTE_DIR:-/home/ubuntu/dtv-visualization}"; project="${DTV_COMPOSE_PROJECT_NAME:-dtv}"
public="${DTV_PUBLIC_HEALTH_URL:-http://162.14.107.55:18087}"
[[ "$remote" =~ ^/[A-Za-z0-9._/-]+$ && "$project" =~ ^[A-Za-z0-9_-]+$ ]] || exit 2
context="$(mktemp -d "${TMPDIR:-/tmp}/dtv-full-deploy.XXXXXX")"
# 从固定提交的隔离快照构建，既不读取开发中的代码，也不回写生成签名文件。
trap 'rm -rf "$context"' EXIT
mkdir -p "$context/source/node_modules/@dtv"
git archive "$commit" | tar -x -C "$context/source"
for dependency in "$repo/node_modules/"* "$repo/node_modules/.bin"; do
 [[ "$(basename "$dependency")" == @dtv ]] || ln -s "$dependency" "$context/source/node_modules/$(basename "$dependency")"
done
for workspace in "$context/source/apps/"* "$context/source/packages/"*; do
 name="$(node -e 'console.log(require(process.argv[1]).name)' "$workspace/package.json")"
 [[ "$name" == @dtv/* ]] || { echo '工作区包名不受支持' >&2; exit 2; }
 ln -s "$workspace" "$context/source/node_modules/$name"
done
(cd "$context/source" && npm run build)
assert_latest() {
 [[ "$(git ls-remote origin "refs/heads/$branch" | cut -f1)" == "$commit" ]] || { echo '构建期间远端版本变化或无法确认最新版本，拒绝切换' >&2; exit 2; }
}
# 只从本次构建生成的dist制作镜像；上下文不含密钥、账号、数据库或npm凭据。
mkdir -p "$context/web/dist" "$context/server/server" "$context/payload/migrations" "$context/payload/licensing"
cp -R "$context/source/apps/web/dist/." "$context/web/dist/"
printf '{"commit":"%s"}\n' "$commit" > "$context/web/dist/deploy-version.json"
cp "$context/source/deploy/nginx.conf" "$context/web/nginx.conf"
cat > "$context/web/Dockerfile" <<'DOCKERFILE'
ARG DTV_WEB_BASE=nginx:1.28-alpine
FROM ${DTV_WEB_BASE}
USER root
ARG DTV_COMMIT
LABEL org.opencontainers.image.revision="$DTV_COMMIT"
RUN rm -rf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/
DOCKERFILE
cp -R "$context/source/dist/server/." "$context/server/server/"; cp "$context/source/scripts/create-account.mjs" "$context/server/create-account.mjs"
printf '{"commit":"%s"}\n' "$commit" > "$context/server/deploy-version.json"
base="$(ssh -p "$port" "$target" "docker ps --filter label=com.docker.compose.project='$project' --filter label=com.docker.compose.service=core-api --format '{{.Image}}'")"
# 依赖契约完全一致时复用上一版依赖层，代码始终替换为最新构建；不符合则重新构建依赖。
if [[ "$base" =~ ^dtv-server:([0-9a-f]{40})$ ]] && docker image inspect "$base" >/dev/null 2>&1 && git cat-file -e "${BASH_REMATCH[1]}^{commit}" 2>/dev/null; then
 base_commit="${base#dtv-server:}"
else base_commit=""; fi
if [[ -n "$base_commit" ]] && git diff --quiet "$base_commit" "$commit" -- package.json package-lock.json ':(glob)apps/*/package.json' ':(glob)packages/*/package.json'; then
 cat > "$context/server/Dockerfile" <<'DOCKERFILE'
ARG DTV_SERVER_BASE
FROM ${DTV_SERVER_BASE}
USER root
ARG DTV_COMMIT
LABEL org.opencontainers.image.revision="$DTV_COMMIT"
RUN rm -rf /app/dist/server
COPY server/ /app/dist/server/
COPY create-account.mjs /app/scripts/create-account.mjs
COPY deploy-version.json /app/deploy-version.json
USER node
DOCKERFILE
 docker buildx build --platform linux/amd64 --build-arg "DTV_SERVER_BASE=$base" --build-arg "DTV_COMMIT=$commit" --load -t "dtv-server:$commit" "$context/server"
else
 docker buildx build --platform linux/amd64 --load -f "$context/source/deploy/server.Dockerfile" --label "org.opencontainers.image.revision=$commit" -t "dtv-server:$commit" "$context/source"
fi
web_base="nginx:1.28-alpine"
if [[ -n "$base_commit" ]] && docker image inspect "dtv-web:$base_commit" >/dev/null 2>&1; then web_base="dtv-web:$base_commit"; fi
docker buildx build --platform linux/amd64 --build-arg "DTV_WEB_BASE=$web_base" --build-arg "DTV_COMMIT=$commit" --load -t "dtv-web:$commit" "$context/web"
cp "$context/source/deploy/compose.yaml" "$context/source/deploy/nginx.conf" "$context/payload/"
cp "$context/source/deploy/migrations/007_runtime_configuration.sql" "$context/payload/migrations/"
cp "$context/source/deploy/licensing/trust-roots.json" "$context/payload/licensing/"
cp "$context/source/scripts/deploy-platform-remote.sh" "$context/payload/"
assert_latest
echo '传输本次Web与服务端镜像（不传输私钥、账号或本机环境文件）…'
docker save "dtv-web:$commit" "dtv-server:$commit" | gzip -1 | ssh -p "$port" "$target" 'gunzip | docker load'
ssh -p "$port" "$target" "umask 077; mkdir -p '$remote/releases/$commit/payload'"
tar -C "$context/payload" -czf - . | ssh -p "$port" "$target" "tar -xzf - -C '$remote/releases/$commit/payload'"
remote_script="$remote/releases/$commit/payload/deploy-platform-remote.sh"
assert_latest
if ! ssh -p "$port" "$target" "DTV_REMOTE_DIR='$remote' DTV_COMPOSE_PROJECT_NAME='$project' bash '$remote_script' deploy '$commit'"; then
 ssh -p "$port" "$target" "DTV_REMOTE_DIR='$remote' DTV_COMPOSE_PROJECT_NAME='$project' bash '$remote_script' recover '$commit'" || true
 exit 1
fi
# 公网失败走相同三服务回退入口，不能只恢复Web造成前后端版本不匹配。
if ! curl -fsS --max-time 15 "$public/deploy-version.json" | grep -Fq "$commit" || ! curl -fsS --max-time 15 "$public/api/health" | grep -Fq "$commit"; then
 ssh -p "$port" "$target" "DTV_REMOTE_DIR='$remote' DTV_COMPOSE_PROJECT_NAME='$project' bash '$remote_script' rollback '$commit'"
 exit 1
fi
ssh -p "$port" "$target" "DTV_REMOTE_DIR='$remote' DTV_COMPOSE_PROJECT_NAME='$project' bash '$remote_script' finalize '$commit'"
echo "全栈部署成功：${public}；提交 $commit"
