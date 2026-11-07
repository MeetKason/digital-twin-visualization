# 数字孪生可视化系统

**Digital Twin Visualization** · `digital-twin-visualization` · 首期开发基线 0.1.0

依据总体技术方案与 Figma 的登录页、气象要素工作台建立。当前可运行登录演示入口、三地区切换、Cesium 地图、图层分类/开关/重试/透明度、站点与坐标搜索、站点观测详情、固定演示时间轴、二维三维切换和地图缩放定位。

当前是明确标记的演示系统。气温/降水网格为示意色块，边框为示例范围，不代表行政边界或业务分析产品。雷达、卫星等未接入产品显示错误原因，不提供伪造实况。路径漫游、完整站点管理、专题、设备与系统管理保留建设入口，尚未实现完整业务。

## 本地启动

使用 Node 22.20.0（最低 22.12）与 npm 10。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 ，点击“进入演示系统”。API 在 http://127.0.0.1:3001/api/health 。演示入口不收集生产密码，不代表生产登录。默认只监听本机。

```bash
npm run check        # 严格类型、ESLint、单元/契约测试、生产构建
npx playwright install chromium
npm run test:e2e     # 自动启动开发服务，验证关键链路和无公网请求
# 也可使用本机已安装的 Google Chrome：
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
WORKER_ONCE=1 npm run worker  # 单次 Mock 采集，默认内存存储
```

`npm run build` 输出 Web 到 `apps/web/dist`，服务端到 `dist/server`。Cesium 体积较大，已独立延迟加载；登录首屏不加载地图引擎。正式部署建议开启服务器 gzip。

## 工程结构

| 目录 | 职责 |
| --- | --- |
| apps/web | Figma 登录与地图工作台，Cesium、本地资源 |
| apps/core-api | NestJS 只读演示 API，场景/图层/时次/搜索 |
| apps/worker | Connector → 校验 → 原子入库/水位线，Mock/内存与 PostgreSQL 存储 |
| packages/contracts | 场景 schema、图层、站点、观测契约与演示数据 |
| packages/sdk | 受控地图接口、可取消图层生命周期、插件安装卸载 |
| packages/plugins | 可独立构建的 station.popup 插槽插件样例 |
| scenarios | 西安、太原、成都三个示例地区配置 |
| deploy | Compose、Dockerfile、Nginx、PostGIS 迁移 |
| scripts | 数据库备份、恢复、离线镜像导出 |
| docs | 已批准建设范围、实施计划与验证记录 |

## 地图与现场配置

编辑 `apps/web/public/config.json`；Compose 使用 `deploy/config.json` 挂载。默认 `basemap: null` 使用 Cesium 包内 NaturalEarthII 低精度底图，所有资源来自本机。不使用 ion、在线地理编码或公网瓦片。当前无地形，使用椭球。

内网 XYZ 示例（占位地址需要替换）：

```json
{"mode":"demo","basemap":{"type":"xyz","url":"/maps/base/{z}/{x}/{y}.png"},"terrainUrl":null,"notice":"内网底图"}
```

WMTS 使用 `type: "wmts"` 并配置 `url, layer, style, format, tileMatrixSetID`。本地反向代理 `/maps` 路径需在 Nginx 中增加到局方地图服务的授权映射；当前 nginx.conf 未预设客户地址。部署前核对 CRS、矩阵、覆盖级别、认证、跨域及证书。浏览器配置不得存放天擎凭据或长期敏感令牌。

## API

所有接口当前只提供 demo 数据，尚未实现用户、租户和权限系统。设置 `DEPLOYMENT_MODE=production` 会拒绝启动，避免误当生产服务。

- `GET /api/health`
- `GET /api/scenes`
- `GET /api/scenes/:id/layers`
- `GET /api/scenes/:id/stations`
- `GET /api/layers/:id/times`
- `GET /api/layers/:id/data?sceneId=xian&time=<ISO8601>`
- `GET /api/search?sceneId=xian&q=<图层/站点/经度,纬度>`

示例时次为 2026-11-07 00:00–12:00，UTC+8。不存在的时次返回 404；不回退旧资料冒充当前时次。API 图层数据是 Mock 生成；Worker 写库是独立采集边界演示，尚未连到 API 查询，不能用 API 页面证明数据库采集链路已打通。

## 插件示例

在站点详情点击“加载示例插件”，宿主读取 `/extensions/example/manifest.json` 并动态加载独立 ESM 文件，注册 `station.popup.footer`；卸载清除插槽。`npm run build:plugin` 仅重新编译插件，无需重编宿主。当前只允许本应用自带的同源示例，不提供任意 URL 加载、签名或生产分发能力。

## Docker 与离线交付

```bash
cp deploy/.env.example deploy/.env
# 修改 deploy/.env 的 POSTGRES_PASSWORD 为现场生成的随机密码
# 在有依赖下载权限且架构匹配的构建机执行：
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml up -d
```

打开 http://127.0.0.1:8080 。API 与数据库不映射主机端口。Worker 的 DATABASE_URL 仅在容器环境中注入，Mock 观测与水位线在一个事务中写入。数据库迁移仅在空卷首次初始化时执行，后续迁移必须显式管理。

```bash
scripts/backup.sh /absolute/path/dtv.dump
# 停止依赖数据库的服务并留存当前备份后，显式执行恢复：
CONFIRM_RESTORE=yes scripts/restore.sh /absolute/path/dtv.dump
scripts/export-images.sh /absolute/path/offline-release
```

目标机导入镜像后用 `docker compose up -d --no-build --pull never` 启动，不能在断网现场执行构建或 npm 安装。离线包需同时交付 deploy、配置、镜像、校验清单以及所需底图/地形/模型。当前尚未生成离线镜像包，也未完成目标 CPU 架构与现场断网验收。PostGIS 镜像须在构建时核对目标架构可用性；Apple Silicon 若镜像不支持原生架构，应在目标 Linux 构建机验证，不能将模拟运行当正式证据。

回滚：保留上一版本镜像、配置和配套数据库快照；停止写入后恢复快照与旧配置，加载旧镜像再启动。当前脚本不自动执行跨版本迁移回滚。

## 后续建设与接入条件

1. 站点类型/导入/档案、模型与视角、双方案巡航；实施前逐页读取相应 Figma 画板。
2. 扩展 SDK 能力，完善签名与授权、插件持久安装；当前已支持同源示例 ESM 插件注册/卸载站点详情插槽。
3. 正式认证、服务端租户/数据范围隔离与审计；目前不能部署为对外开放的生产系统。
4. 天擎现场 Connector、真实响应校验、分页、限流/重试、补数、队列与监控；API 查询真实数据库。
5. 完成断公网、内网地图/天擎链路、备份恢复、性能与升级回滚验收。

设计来源：[Figma 工作台](https://www.figma.com/design/2DzJheli9wLvLfhPkqgUBG?node-id=1784-23928) 与用户提供的总体技术方案。登录背景和图标从 Figma 下载到 `apps/web/public/design`，保留原文件；产品标识按用户要求使用统一项目名称。地图本身为 Cesium 动态渲染，不使用 Figma 地图截图。
