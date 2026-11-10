#!/usr/bin/env bash
set -Eeuo pipefail

# 在服务器上预检并切换 Web 容器；失败时恢复切换前运行的镜像。
remote_dir="${DTV_REMOTE_DIR:-/home/ubuntu/dtv-visualization}"
compose_project="${DTV_COMPOSE_PROJECT_NAME:-dtv}"
compose_file="$remote_dir/compose.yaml"
mode="deploy"
if [[ "${1:-}" == "rollback" ]]; then
  mode="rollback"
  commit="${2:-}"
else
  commit="${1:-}"
fi
if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "提交号必须是 40 位十六进制 SHA。" >&2
  exit 2
fi
if [[ ! -f "$compose_file" ]]; then
  echo "找不到 Compose 配置：$compose_file" >&2
  exit 2
fi

image="dtv-web:$commit"
rollback_image="dtv-web:rollback-$commit"
compose() {
  COMPOSE_PROJECT_NAME="$compose_project" DTV_VERSION="$1" docker compose -f "$compose_file" "${@:2}"
}
check_live() {
  local expected="${1:-}"
  curl -fsS --max-time 8 http://127.0.0.1:18087/health >/dev/null &&
    curl -fsS --max-time 8 http://127.0.0.1:18087/api/health >/dev/null || return 1
  if [[ -n "$expected" ]]; then
    curl -fsS --max-time 8 http://127.0.0.1:18087/deploy-version.json | grep -Fq "$expected"
  fi
}
restore_previous() {
  echo "正在恢复此前的 Web 镜像…" >&2
  if ! docker image inspect "$rollback_image" >/dev/null 2>&1; then
    echo "回退镜像不存在：$rollback_image" >&2
    return 1
  fi
  if compose "rollback-$commit" up -d --no-deps --force-recreate --wait --wait-timeout 90 web && check_live; then
    echo "已恢复此前 Web 版本，健康检查通过。" >&2
    return 0
  fi
  echo "自动回退后健康检查仍失败，请立即检查服务器容器日志。" >&2
  return 1
}

if [[ "$mode" == "rollback" ]]; then
  restore_previous
  exit $?
fi

# 部署之前确认旧服务健康，并记录其真实镜像 ID，避免依赖可变标签。
old_container="$(compose "$commit" ps -q web)"
if [[ -z "$old_container" ]] || ! check_live; then
  echo "现有 Web/API 服务未通过健康检查，拒绝切换。" >&2
  exit 1
fi
old_image_id="$(docker inspect --format '{{.Image}}' "$old_container")"
docker tag "$old_image_id" "$rollback_image"

# 通过容器实际网络进行无端口预检，确认静态资源、版本标识和 API 代理可用。
network="$(docker inspect --format '{{range $name, $_ := .NetworkSettings.Networks}}{{printf "%s" $name}}{{end}}' "$old_container")"
if [[ -z "$network" ]]; then
  echo "无法确定现有 Web 容器网络，拒绝部署。" >&2
  exit 1
fi
preflight="dtv-web-preflight-$commit"
docker rm -f "$preflight" >/dev/null 2>&1 || true
if ! docker run -d --name "$preflight" --network "$network" \
  -v "$remote_dir/config.json:/usr/share/nginx/html/config.json:ro" "$image" >/dev/null; then
  echo "新镜像预检容器启动失败，线上服务未变更。" >&2
  exit 1
fi
preflight_ok=false
for _ in $(seq 1 20); do
  if docker exec "$preflight" wget -q -O /dev/null http://127.0.0.1/health \
    && docker exec "$preflight" wget -q -O - http://127.0.0.1/deploy-version.json | grep -Fq "$commit" \
    && docker exec "$preflight" wget -q -O /dev/null http://127.0.0.1/api/health; then
    preflight_ok=true
    break
  fi
  sleep 2
done
docker rm -f "$preflight" >/dev/null 2>&1 || true
if [[ "$preflight_ok" != true ]]; then
  echo "新镜像预检失败（Web/API/版本检查），线上服务未变更。" >&2
  exit 1
fi

# 只重建 Web；--no-deps 明确禁止 Compose 重启 API、Worker 或数据库。
if compose "$commit" up -d --no-deps --force-recreate --wait --wait-timeout 90 web && check_live "$commit"; then
  echo "服务器部署成功：$commit；旧 Web 镜像保留为 $rollback_image。"
  exit 0
fi

echo "新 Web 未通过切换后健康检查，开始自动回退。" >&2
restore_previous
exit 1
