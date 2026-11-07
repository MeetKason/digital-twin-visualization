# 数字孪生可视化系统

**Digital Twin Visualization** · `digital-twin-visualization` · 服务端基础版本 0.2.0

以用户最新要求为准，界面与功能**仅参考 Figma「新电子沙盘」Page（1393:37400）**，其余 Page 不参考。按左侧菜单顺序实现本地演示交互。

| 菜单 | 当前能力 |
| --- | --- |
| 总览地图 | 气象/基础/站点目录；图层开关、透明度、失败重试；站点与坐标搜索；二维三维、缩放、旋转、倾斜；距离/面积测量与坐标拾取；视角书签；雨雪雾互斥视觉模拟；时间轴 |
| 路径漫游 | 新建/编辑/保存/删除方案；从站点或地图添加节点，排序与删除；环绕半径、角度、方向、时长、循环；转场时长、飞行高度、平滑/线性曲线；模型与视角绑定；开始、暂停、继续、停止 |
| 点位管理 | 搜索/分类、录入/编辑、CSV 模板/预校验/确认导入/导出；模型与默认巡航视角；视频/PDF 关联和查看；Mock 观测摘要与趋势 |
| 气象专题 | 四类专题切换，地图图层、重点站点、指标与列表联动；仅显示可追溯的 Mock 观测，不输出伪造风险范围与正式预警 |
| 设备监控 | 原 Page 无独立画板，仅保留明确“设备源未接入”的页面，可检查真实本机 API 健康 |
| 系统管理 | 依照现有管理目录提供演示用户/角色/状态维护、部署配置查看与导出、站点资料概览与导出 |

**当前为本地演示工程，不能作为生产系统验收。** 气温/降水为示意色块，边框为示例范围。雷达、卫星、正式基础地理产品缺少授权源时显示未接入原因。

站点、方案、书签、模型元数据和演示用户配置按**服务端会话的租户与场景**保存。开发启动默认使用 `apps/core-api/.data/platform.json`，配置 `DATABASE_URL` 或 `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` 后使用 PostgreSQL。保存采用修订号 CAS，冲突或失败会提示并恢复最后确认版本；页面提供重新加载。相同真实账号/租户可跨浏览器共享元数据，演示入口则分配独立演示租户。

模型与视频/PDF 二进制**仍在本浏览器 IndexedDB**，尚未迁移到服务器文件服务。因此另一浏览器虽能读到模型元数据，仍不能读取这台浏览器的文件；这部分不能作为跨租户文件隔离的生产能力验收。旧 `localStorage` 资料不会自动混入新租户，页面提供显式迁移入口，旧记录不删除。

模型仅接收 GLB 2.0 或内嵌资源 GLTF 2.0，禁止引用外部纹理/缓冲区。单文件上限 100MB，CSV 上限 2MB。模型与书签被引用时禁止删除。预览关闭后销毁资源，离开漫游会停止相机动画。

测量结果为球面近似，仅供演示；默认椭球地形的拾取高度不是实测高程。页面的用户与角色表仍是演示配置；真实登录账号和角色由服务端配置决定，并由 API 强制校验。新电子沙盘未定义的设备协议、视频平台和正式权限接口不会从其他 Figma Page 补造。

## 本地启动

使用 Node 22.20.0（最低 22.12）与 npm 10。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 ，点击“进入演示系统”。API 在 http://127.0.0.1:3001/api/health 。默认只监听本机。演示入口建立独立服务器会话；也可按下文配置账号登录。

```bash
npm run smoke:built  # 构建后 API 冒烟检查（先运行 build）
npm run check        # 严格类型、ESLint、单元/契约测试、生产构建
npx playwright install chromium
npm run test:e2e     # 自动启动开发服务，验证关键链路和无公网请求
# 也可使用本机已安装的 Google Chrome：
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
WORKER_ONCE=1 npm run worker  # 单次 Mock 采集，默认内存存储
```

`npm run build` 输出 Web 到 `apps/web/dist`，服务端到 `dist/server`。Cesium 体积较大，已独立延迟加载；登录首屏不加载地图引擎。正式部署建议开启服务器 gzip。

## 配置登录账号

无需内网或外部身份服务即可验证服务器账号。密码从 stdin 输入，脚本只保存 scrypt 哈希，不输出密码/哈希，不覆盖已有账号：

```bash
read -s DTV_ACCOUNT_PASSWORD
printf '%s' "$DTV_ACCOUNT_PASSWORD" | node scripts/create-account.mjs --id admin --tenant customer-a --role admin --scenes xian,taiyuan --output deploy/auth/users.json
unset DTV_ACCOUNT_PASSWORD
AUTH_USERS_FILE="$PWD/deploy/auth/users.json" DEMO_ENABLED=false npm run dev
```

密码至少 12 字符。重新启动 API 后配置生效。账号配置文件已加入 Git 和 Docker 构建忽略规则，不能放入前端资源。禁用账号、修改密码或删除账号会使旧会话失效；会话有效期 8 小时，注销会撤销服务器会话。

Compose 使用时，在 `deploy/.env` 设置 `AUTH_USERS_FILE=/run/dtv-auth/users.json`，配置目录以只读方式挂载。Linux 镜像使用 node 用户（UID 1000），部署管理员需按目标 UID 分配配置目录和文件的只读访问权限；脚本新建目录时请求 700 权限，账号文件使用 600 权限。外部访问还需局方 TLS/证书及 `COOKIE_SECURE=true`。当前 Compose 是单层 Nginx，覆盖客户端转发头并显式信任 1 跳；不要在未经确认的多级代理环境直接沿用。

```bash
npm run test:postgres  # 需要 Docker；临时 PostgreSQL 16 容器验证，结束自动清理
```

## 工程结构

| 目录 | 职责 |
| --- | --- |
| apps/web | Figma 登录与地图工作台，Cesium、本地资源 |
| apps/core-api | NestJS 认证、租户/角色/场景授权、业务持久化与审计 |
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

除 health、auth/session 与登录入口外，业务接口需要有效 HttpOnly 会话。写入必须有 `X-DTV-Request: 1`，浏览器 Origin 必须匹配 Host。正式气象数据仍未接入；生产启动保护继续保留。

- `GET /api/health`、`GET /api/auth/session`
- `POST /api/auth/login`、`POST /api/auth/demo`、`POST /api/auth/logout`
- `GET /api/scenes`：仅返回有权访问的场景
- `GET /api/scenes/:id/layers`、`GET /api/scenes/:id/stations`
- `GET /api/scenes/:id/business`
- `PUT /api/scenes/:id/business`：提交 `{revision, owner:{id,tenantId}, data}`；只读拒写、owner 改变拒写、旧修订返回 409
- `GET /api/audit`：仅管理员查看自己租户的审计
- `GET /api/layers/:id/times?sceneId=xian`
- `GET /api/layers/:id/data?sceneId=xian&time=<ISO8601>`
- `GET /api/search?sceneId=xian&q=<图层/站点/经度,纬度>`

客户端请求中的租户声明不授予权限；实际租户、角色和场景范围取自服务器会话。管理员为 admin，操作员 editor，只读 viewer；editor 可以改业务资料，不能改用户演示配置。
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

打开 http://127.0.0.1:8080 。API 与数据库不映射主机端口。核心 API 与 Worker 的 PostgreSQL 连接参数仅在容器环境注入。Mock 观测与水位线在一个事务中写入。数据库迁移仅在空卷首次初始化时执行，后续迁移必须显式管理。

```bash
scripts/backup.sh /absolute/path/dtv.dump
# 停止依赖数据库的服务并留存当前备份后，显式执行恢复：
CONFIRM_RESTORE=yes scripts/restore.sh /absolute/path/dtv.dump
scripts/export-images.sh /absolute/path/offline-release
```

目标机导入镜像后用 `docker compose up -d --no-build --pull never` 启动，不能在断网现场执行构建或 npm 安装。离线包需同时交付 deploy、配置、镜像、校验清单以及所需底图/地形/模型。当前尚未生成离线镜像包，也未完成目标 CPU 架构与现场断网验收。PostGIS 镜像须在构建时核对目标架构可用性；Apple Silicon 若镜像不支持原生架构，应在目标 Linux 构建机验证，不能将模拟运行当正式证据。

回滚：保留上一版本镜像、配置和配套数据库快照；停止写入后恢复快照与旧配置，加载旧镜像再启动。当前脚本不自动执行跨版本迁移回滚。

## 后续接入条件

1. 正式身份体系与账号管理界面、许可证/套餐/数据集授权；服务器文件服务及跨浏览器模型/附件；实体化业务表和发布流程。
2. 天擎现场 Connector、真实响应校验、分页、限流/重试、补数与监控；API 查询真实数据库。当前 Worker 与 Mock API 仍是独立边界演示。
3. 内网天地图、地形与正式模型/附件服务；设备监控的画板、协议和数据清单。
4. 正式气象风险算法与预警源，不能以演示色块代替业务判断。
5. 完成目标架构镜像、断公网、内网地图/天擎链路、备份恢复、性能与升级回滚验收。

设计来源：[Figma 工作台](https://www.figma.com/design/2DzJheli9wLvLfhPkqgUBG?node-id=1784-23928) 与用户提供的总体技术方案。登录背景和图标从 Figma 下载到 `apps/web/public/design`，保留原文件；产品标识按用户要求使用统一项目名称。地图本身为 Cesium 动态渲染，不使用 Figma 地图截图。
