#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# 全栈发布只操作指定Compose项目；新增表向后兼容，回退不覆盖部署后的业务写入。
root="${DTV_REMOTE_DIR:-/home/ubuntu/dtv-visualization}"
project="${DTV_COMPOSE_PROJECT_NAME:-dtv}"
mode="${1:-}"; commit="${2:-}"
[[ "$mode" =~ ^(deploy|rollback|finalize|recover)$ && "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo '部署参数无效' >&2; exit 2; }
[[ "$root" =~ ^/[A-Za-z0-9._/-]+$ && "$project" =~ ^[A-Za-z0-9_-]+$ ]] || exit 2
cd "$root"
exec 9>"$root/.deploy.lock"
flock -n 9 || { echo '已有发布任务执行中' >&2; exit 2; }
release="$root/releases/$commit"; payload="$release/payload"; backup="$release/backup"
api_probe="$project-api-preflight-${commit:0:12}"; web_probe="$project-web-preflight-${commit:0:12}"
compose() { DTV_VERSION="$1" docker compose --project-name "$project" --env-file "$root/.env" -f "$root/compose.yaml" "${@:2}"; }
cleanup_probe() { docker rm -f "$web_probe" "$api_probe" >/dev/null 2>&1 || true; }
port="${DTV_WEB_PORT:-18087}"
[[ "$port" =~ ^[0-9]+$ ]] || exit 2
check_live() {
 curl -fsS --max-time 8 "http://127.0.0.1:$port/health" >/dev/null && curl -fsS --max-time 8 "http://127.0.0.1:$port/api/health" >/dev/null || return 1
 if [[ -n "${1:-}" ]]; then
  curl -fsS --max-time 8 "http://127.0.0.1:$port/deploy-version.json" | grep -Fq "$1" && curl -fsS --max-time 8 "http://127.0.0.1:$port/api/health" | grep -Fq "$1"
 fi
}
restore() {
 [[ -s "$backup/compose.yaml" && -s "$backup/env" ]] || { echo '缺少旧版配置，无法自动回退' >&2; return 1; }
 cp "$backup/compose.yaml" "$root/compose.yaml"; cp "$backup/env" "$root/.env"
 # 持久化回退标签，后续普通compose up也继续使用已固定的旧镜像。
 printf '\nDTV_VERSION=rollback-%s\n' "$commit" >> "$root/.env"
 compose "rollback-$commit" up -d --no-build --pull never --no-deps --force-recreate --wait --wait-timeout 90 core-api worker web
 check_live
 touch "$release/rolled-back"
 [[ ! -f "$root/.pending-deploy" || "$(cat "$root/.pending-deploy")" != "$commit" ]] || rm "$root/.pending-deploy"
 echo '已恢复旧Web/API/Worker；数据库及文件卷保留。' >&2
}
if [[ "$mode" == recover ]]; then
 if [[ -f "$root/.pending-deploy" && "$(cat "$root/.pending-deploy")" == "$commit" && ! -f "$release/public-verified" && ! -f "$release/rolled-back" ]]; then restore; else check_live; fi
 exit $?
fi
if [[ "$mode" == rollback ]]; then cleanup_probe; restore; exit $?; fi
if [[ "$mode" == finalize ]]; then check_live "$commit"; touch "$release/public-verified"; [[ ! -f "$root/.pending-deploy" || "$(cat "$root/.pending-deploy")" != "$commit" ]] || rm "$root/.pending-deploy"; exit 0; fi
[[ -s "$payload/compose.yaml" && -s "$payload/migrations/007_runtime_configuration.sql" && -s "$payload/licensing/trust-roots.json" ]] || { echo '发布文件不完整' >&2; exit 2; }
[[ ! -e "$backup" ]] || { echo '本次发布已有备份，不覆盖原备份；请检查现有发布状态' >&2; exit 2; }
check_live || { echo '现有服务不健康，拒绝发布' >&2; exit 1; }
for image in "dtv-web:$commit" "dtv-server:$commit"; do
 [[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")" == "$commit" ]] || { echo '镜像提交标识不匹配' >&2; exit 2; }
done
mkdir -p "$backup"
cp "$root/compose.yaml" "$backup/compose.yaml"; cp "$root/.env" "$backup/env"
cp "$root/config.json" "$backup/config.json"; cp -R "$root/auth" "$backup/auth"
[[ ! -d "$root/licensing" ]] || cp -R "$root/licensing" "$backup/licensing"
old_api="$(compose "$commit" ps -q core-api)"; old_web="$(compose "$commit" ps -q web)"
[[ -n "$old_api" && -n "$old_web" ]] || exit 2
old_server="$(docker inspect --format '{{.Image}}' "$old_api")"; old_web_image="$(docker inspect --format '{{.Image}}' "$old_web")"
docker tag "$old_server" "dtv-server:rollback-$commit"; docker tag "$old_web_image" "dtv-web:rollback-$commit"
# 由inspect在服务器内生成受限环境文件，绝不把环境值输出到终端。
python3 - "$old_api" "$old_web" "$release" "$root" "$commit" <<'PY'
import subprocess,json,sys,os,re
api,web,release,root,commit=sys.argv[1:]
a=json.loads(subprocess.check_output(['docker','inspect',api]))[0]
w=json.loads(subprocess.check_output(['docker','inspect',web]))[0]
env=dict(item.split('=',1) for item in a['Config']['Env'] if '=' in item)
users=json.load(open(root+'/auth/users.json'))
admin=next((u['id'] for u in users if u['id']=='admin' and u['role']=='admin' and not u.get('disabled')),None)
if not admin:
 candidates=[u['id'] for u in users if u['role']=='admin' and not u.get('disabled')]
 if len(candidates)==1: admin=candidates[0]
# 未配置时仅延续既有唯一维护管理员，不将全部租户管理员升级为平台管理员。
if not env.get('PLATFORM_ADMIN_IDS') and admin: env['PLATFORM_ADMIN_IDS']=admin
values={line.split('=',1)[0]:line.split('=',1)[1].rstrip('\n') for line in open(root+'/.env') if '=' in line and not line.startswith('#')}
for key in ['PLATFORM_ADMIN_IDS','LICENSE_REQUIRED','DEPLOYMENT_MODE']:
 if key in values:env[key]=values[key]
env.setdefault('LICENSE_REQUIRED','false');env.setdefault('DEPLOYMENT_MODE','demo')
env.update(HOST='0.0.0.0',PORT='3001',DTV_COMMIT=commit,LICENSE_TRUST_ROOTS_FILE='/run/dtv-licensing/trust-roots.json')
if any('\n' in value or '\r' in value for value in env.values()):raise RuntimeError('环境包含不支持的换行，拒绝发布')
with open(release+'/preflight.env','w') as f:f.write(''.join(k+'='+v+'\n' for k,v in env.items()))
files=next(m['Name'] for m in a['Mounts'] if m['Destination']=='/app/.data/files' and m['Type']=='volume')
networks=list(w['NetworkSettings']['Networks'])
if len(networks)!=1 or not re.fullmatch('[a-zA-Z0-9_.-]+',files):raise RuntimeError('网络或数据卷不明确')
json.dump({'network':networks[0],'files':files,'oldServer':a['Config']['Image'],'oldWeb':w['Config']['Image']},open(release+'/state.json','w'))
with open(release+'/new.env','w') as f:
 f.write(open(root+'/.env').read().rstrip('\n')+'\n')
 for k in ['PLATFORM_ADMIN_IDS','LICENSE_REQUIRED','DEPLOYMENT_MODE']:f.write(k+'='+env.get(k,'')+'\n')
 f.write('DTV_VERSION='+commit+'\n')
PY
network="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["network"])' "$release/state.json")"
files_volume="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["files"])' "$release/state.json")"
stopped=false; switched=false
on_error() {
 local result=$?
 [[ "$result" != 0 ]] || result=1
 trap - ERR INT TERM HUP
 cleanup_probe
 if [[ "$switched" == true ]]; then restore || echo '自动回退未通过检查，需按保留备份排查' >&2
 elif [[ "$stopped" == true ]]; then compose "rollback-$commit" start core-api worker web || true
 fi
 echo '部署未完成；已保留备份和诊断状态。' >&2
 exit "$result"
}
trap on_error ERR INT TERM HUP
# 备份仅短暂停止本项目写服务；dump和文件归档完成即恢复旧版本，预检阶段继续对外服务。
echo '正在创建数据库与文件的一致备份…'
stopped=true
compose "rollback-$commit" stop -t 45 web core-api worker
compose "rollback-$commit" exec -T postgres pg_dump -U dtv -d dtv -Fc > "$backup/database.dump"
docker run --rm --network none --read-only --user 0 --entrypoint tar -v "$files_volume:/data:ro" "$old_server" -C /data -czf - . > "$backup/files.tar.gz"
[[ -s "$backup/database.dump" && -s "$backup/files.tar.gz" ]]
gzip -t "$backup/files.tar.gz"
compose "rollback-$commit" exec -T postgres pg_restore -l < "$backup/database.dump" > "$backup/database-index.txt"
(cd "$backup" && shasum -a 256 database.dump files.tar.gz > SHA256SUMS)
compose "rollback-$commit" start core-api worker web
stopped=false
# 007只新增配置表，旧版本可以继续使用；升级失败时保留该兼容表而不倒灌旧数据。
compose "rollback-$commit" exec -T postgres psql -U dtv -d dtv -v ON_ERROR_STOP=1 -1 < "$payload/migrations/007_runtime_configuration.sql" >/dev/null
# 预检不映射端口，挂载真实资料只读，不启动第二个采集Worker，也不执行业务写入。
cleanup_probe
sed "s@http://core-api:3001@http://$api_probe:3001@g" "$payload/nginx.conf" > "$release/preflight-nginx.conf"
chmod 644 "$release/preflight-nginx.conf" "$payload/licensing/trust-roots.json"
docker run -d --name "$api_probe" --network "$network" --read-only --env-file "$release/preflight.env" \
 -v "$root/auth:/run/dtv-auth:ro" -v "$root/tianqing:/run/dtv-tianqing:ro" -v "$payload/licensing:/run/dtv-licensing:ro" -v "$files_volume:/app/.data/files:ro" \
 "dtv-server:$commit" node dist/server/core-api/src/main.js >/dev/null
preflight_ok=false
for _ in $(seq 1 25); do
 if docker exec "$api_probe" node -e 'fetch("http://127.0.0.1:3001/api/health").then(async r=>{const v=await r.json();process.exit(r.ok&&v.commit===process.env.DTV_COMMIT?0:1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then preflight_ok=true; break; fi
 sleep 2
done
[[ "$preflight_ok" == true ]] || { echo '新API预检失败，保留旧服务' >&2; false; }
docker run -d --name "$web_probe" --network "$network" -v "$root/config.json:/usr/share/nginx/html/config.json:ro" -v "$release/preflight-nginx.conf:/etc/nginx/conf.d/default.conf:ro" "dtv-web:$commit" >/dev/null
sleep 2
docker exec "$web_probe" wget -q -O /dev/null http://127.0.0.1/health
docker exec "$web_probe" wget -q -O - http://127.0.0.1/deploy-version.json | grep -Fq "$commit"
docker exec "$web_probe" wget -q -O - http://127.0.0.1/api/health | grep -Fq "$commit"
cleanup_probe
# 将配置与镜像一起切换；ERR trap从此负责恢复三项服务及旧配置。
switched=true
printf '%s\n' "$commit" > "$root/.pending-deploy"
# 若SSH或本地进程在切换后中断，未收到公网确认时由服务器自行回退。
nohup bash -c 'exec 9>&-; sleep 240; DTV_REMOTE_DIR="$1" DTV_COMPOSE_PROJECT_NAME="$2" bash "$3" recover "$4"' _ "$root" "$project" "$payload/deploy-platform-remote.sh" "$commit" > "$release/watchdog.log" 2>&1 < /dev/null &
cp "$payload/compose.yaml" "$root/compose.yaml"; cp "$release/new.env" "$root/.env"
mkdir -p "$root/licensing"
[[ -f "$root/licensing/trust-roots.json" ]] || cp "$payload/licensing/trust-roots.json" "$root/licensing/trust-roots.json"
chmod 644 "$root/licensing/trust-roots.json"
cp "$payload/migrations/007_runtime_configuration.sql" "$root/migrations/007_runtime_configuration.sql"
compose "$commit" up -d --no-build --pull never --no-deps --force-recreate --wait --wait-timeout 90 core-api worker web
check_live "$commit"
worker="$(compose "$commit" ps -q worker)"
[[ -n "$worker" && "$(docker inspect --format '{{.State.Running}} {{.RestartCount}}' "$worker")" == 'true 0' ]]
# 在真实Worker容器内检查共享存储和环境，避免只看进程存在而忽略配置错误。
docker exec "$worker" node --input-type=module -e 'import pg from "pg";const p=new pg.Pool(process.env.DATABASE_URL?{connectionString:process.env.DATABASE_URL}:{});try{await p.query("SELECT 1 FROM platform_configuration LIMIT 0");if(process.env.DTV_COMMIT!==process.argv[1])process.exitCode=1}finally{await p.end()}' "$commit"
touch "$release/server-verified"
trap - ERR INT TERM HUP
echo "服务器全栈切换通过；等待公网核验。版本=${commit}；备份=$backup"
