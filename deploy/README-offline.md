# 离线交付操作手册

## 构建并校验离线安装包

在可联网且能够构建 Docker 镜像的构建机上，从仓库根目录执行：

```bash
scripts/package-offline-release.sh 0.3.0 /absolute/path/dtv-release-0.3.0
```

请按目标服务器的 CPU 架构构建，或为 Docker Buildx 配置目标架构。安装包包含 Compose 文件、配置、全部 SQL 迁移、账号目录、账号初始化脚本、备份/恢复/迁移脚本、镜像归档和校验和文件。通过批准的离线渠道传输整个目录。若部署需要本地地图或模型资产，请另行附带已获许可的数据；本安装包不会生成或捆绑第三方数据集。

加载任何镜像前先校验传输文件：

```bash
cd /path/to/dtv-release-0.3.0
shasum -a 256 -c SHA256SUMS
shasum -a 256 -c images.sha256
```

## 首次离线安装

```bash
cd deploy
cp .env.example .env
# 设置现场生成的 POSTGRES_PASSWORD；经 HTTPS 访问时保留 DEMO_ENABLED=false 和 COOKIE_SECURE=true。
cp tianqing/sources.example.json tianqing/sources.json
# 接口地址和账号凭据仅保存在服务器；每个地区编辑自己的场景配置。
chmod 600 tianqing/sources.json
# API/Worker 容器以 node（UID/GID 1000）运行；Linux 主机只向该用户组授予读取权限：
sudo chgrp 1000 tianqing/sources.json && chmod 640 tianqing/sources.json
cd ..
docker load -i images.tar
DTV_VERSION=0.3.0 docker compose -f deploy/compose.yaml config --quiet
# 确保 deploy/auth 可由容器 UID 1000 写入，再创建首个管理员账号。
sudo chown 1000:1000 deploy/auth && sudo chmod 700 deploy/auth
read -s DTV_ACCOUNT_PASSWORD
printf '%s' "$DTV_ACCOUNT_PASSWORD" | DTV_VERSION=0.3.0 AUTH_USERS_FILE=/run/dtv-auth/users.json docker compose -f deploy/compose.yaml run --rm --no-deps -T core-api node scripts/create-account.mjs --id admin --tenant customer-a --role admin --scenes xian,taiyuan,chengdu --output /run/dtv-auth/users.json
unset DTV_ACCOUNT_PASSWORD
DTV_VERSION=0.3.0 docker compose -f deploy/compose.yaml up -d --no-build --pull never
```

服务器需预先安装 Docker Engine 和 Compose，镜像必须匹配目标 CPU 架构。本流程不安装软件包，也不从网络拉取镜像。应用自带的静态资源无需浏览器访问公网；配置的底图、地形或模型服务必须能从相应运行环境访问。

默认 Web 绑定 `127.0.0.1:8080`，用于接入服务器反向代理。只有在防火墙和上游 TLS 终止配置完成后，才设置 `WEB_BIND_ADDRESS=0.0.0.0` 和适用的 `WEB_PORT`。用户通过 HTTPS 访问时必须设置 `COOKIE_SECURE=true`。示例环境关闭演示登录并启用安全 Cookie；仅在隔离的本地评估环境中，才设置 `DEMO_ENABLED=true` 和 `COOKIE_SECURE=false`。接入天地图时，将浏览器端 Key 配置在 `deploy/.env` 的 `TDT_API_KEY` 中。已登录用户的地图通过 API 配置接口获取该 Key，并由浏览器直接请求 WMTS；由于浏览器端 Key 会出现在瓦片请求中，请在天地图控制台限制授权域名。接入 Cesium World Terrain 时，在 `deploy/.env` 配置 `CESIUM_ION_ACCESS_TOKEN`，使用仅能读取所需地形资源且限制允许站点来源的令牌；地图通过登录保护的 API 配置接口按需读取令牌，浏览器直接请求 Cesium ion 地形服务，因此需要外网访问。未配置令牌或服务不可达时，地图保留椭球并提示真实地形未加载。生产数据、许可证、容量、安全控制和目标主机验收完成前，API 会拒绝 `DEPLOYMENT_MODE=production`，因此本安装包运行于演示/Mock 模式。

## 升级与回滚

1. 校验安装包哈希和目标架构；保留上一版安装目录与镜像标签。
2. 使用 `scripts/backup.sh /absolute/path/pre-upgrade` 创建完整备份。
3. 加载新镜像并停止应用，然后从安装包根目录执行 `scripts/apply-migrations.sh`。脚本按文件名顺序执行迁移，完成后应用保持停止。
4. 使用新 Compose 文件和 `--no-build --pull never` 启动，再检查 `/health`、`/api/health`、登录、地图和一条示例数据查询。
5. 回滚时停止服务，使用 `CONFIRM_RESTORE=yes scripts/restore.sh ...` 恢复升级前备份，再启动保留的旧镜像版本。数据库降级脚本不用于回滚；回滚方式是恢复完整备份。

升级或回滚时都不要删除 PostgreSQL 数据卷。现场验收前，应在与目标环境操作系统、Docker 版本、架构、挂载权限和本地数据集一致的隔离测试主机上，完整测试安装包、Compose 配置、数据库迁移、备份和恢复。
