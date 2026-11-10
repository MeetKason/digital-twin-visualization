# 数字孪生可视化系统

**Digital Twin Visualization** · `digital-twin-visualization` · 采集与查询闭环版 0.3.0


| 菜单 | 当前能力 |
| --- | --- |
| 总览地图 | 气象/基础/站点目录；图层开关、透明度、失败重试；站点与坐标搜索；二维三维、缩放、旋转、倾斜；距离/面积测量与坐标拾取；视角书签；雨雪雾互斥视觉模拟；时间轴 |
| 路径漫游 | 新建/编辑/保存/删除方案；从站点或地图添加节点，排序与删除；环绕半径、角度、方向、时长、循环；转场时长、飞行高度、平滑/线性曲线；模型与视角绑定；开始、暂停、继续、停止 |
| 点位管理 | 搜索/分类、录入/编辑、CSV 模板/预校验/确认导入/导出；模型与默认巡航视角；视频/PDF 关联和查看；Mock 观测摘要与趋势 |
| 气象专题 | 四类专题切换，地图图层、重点站点、指标与列表联动；仅显示可追溯的 Mock 观测，不输出伪造风险范围与正式预警 |
| 设备监控 | 独立设备页展示确定性 Mock 在线/告警/离线、心跳、电量、信号和温度；真实设备与视频协议待接入 |
| 系统管理 | 依照现有管理目录提供演示用户/角色/状态维护、部署配置查看与导出、站点资料概览与导出；采集任务、补数、定时计划、失败重试/取消、入库预览与地图数据模式 |

**当前可部署为服务器上的 Mock/演示实例，不能作为生产系统验收。** 地面观测及天气产品图层使用确定性 Mock 数据并明确标识；基础地理产品、地形和模型资产需由部署方提供。真实气象、设备与正式预警算法后续接入。

### 当前服务器部署

- 服务器：`162.14.107.55`，Docker Compose 项目 `dtv`，部署目录 `/home/ubuntu/dtv-visualization`。
- Web：`http://162.14.107.55:18087`；API 和 PostgreSQL 不直接映射公网端口。
- 运行方式：`linux/amd64` Docker 镜像，PostgreSQL/PostGIS 持久卷，独立 Worker；数据源为 Mock，未启用天擎。
- 登录：服务器管理员账号由服务端账号文件管理。初始密码保存在部署操作员本机的 `work/deploy-secrets/server-admin-password.txt`，不要提交、复制到 README 或发送到群聊；首次登录后请立即更换。
- 当前入口使用 HTTP。HTTP 不加密登录流量，只用于临时联调；正式用户访问前应配置 HTTPS/TLS，并保持 Secure Cookie。
- 服务器 Web 绑定公网网卡的 `18087`。若无法访问，检查云平台安全组和主机防火墙是否均允许 TCP `18087`。
- 既有 Nginx 的 80/443 及其他容器服务未改动。

重新部署时先备份数据库与文件卷；镜像版本、Compose 配置和迁移步骤见下方离线交付章节。不要直接删除 `dtv_postgres-data` 或 `dtv_platform-files` 卷。

站点、方案、书签、模型元数据和演示用户配置按**服务端会话的租户与场景**保存。开发启动默认使用 `apps/core-api/.data/platform.json`，配置 `DATABASE_URL` 或 `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD` 后使用 PostgreSQL。保存采用修订号 CAS，冲突或失败会提示并恢复最后确认版本；页面提供重新加载。相同真实账号/租户可跨浏览器共享元数据，演示入口则分配独立演示租户。

模型与视频/PDF 新文件保存到服务器受控目录，按会话租户与地区授权，使用同一租户的真实账号可跨浏览器读取。开发环境文件位于 `DATA_DIR/files`（默认 `apps/core-api/.data/files`），Compose 使用独立持久卷。文件名不能控制物理路径，上传内容检查、100MB 流式上限、服务器引用校验与删除保护已接入。旧 IndexedDB 文件仍可在原浏览器读取，点“迁移到服务器”后显式上传，旧文件保留；旧 `localStorage` 资料也须显式迁移，不会自动混入新租户。

模型仅接收 GLB 2.0 或内嵌资源 GLTF 2.0，禁止引用外部纹理/缓冲区。单文件上限 100MB，CSV 上限 2MB。模型与书签被引用时禁止删除。删除文件先保存资料变更，再清理二进制；保存失败会尝试回收上传。“查看未关联文件”可处理上传中断或删除失败遗留的资源，支持失败重试；服务端仍会拒绝删除已有引用的文件。当前文件操作锁只适用于单 API 实例；病毒扫描、容量配额、跨实例锁及对象存储尚未提供。预览关闭后销毁资源，离开漫游会停止相机动画。

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
# 独立Worker需先配置 PG* 或 DATABASE_URL 并迁移数据库；本地开发由API内执行器处理
WORKER_ONCE=1 npm run worker  # 单次领取队列，非按固定租户生成资料
```

`npm run build` 输出 Web 到 `apps/web/dist`，服务端到 `dist/server`。Cesium 体积较大，已独立延迟加载；登录首屏不加载地图引擎。正式部署建议开启服务器 gzip。

### 本地性能基线

运行 `npm run perf:baseline -- --samples 5` 会临时启动隔离的 Mock API 与 Web 服务，在临时数据目录完成地图首屏、气温图层、固定小型 GLTF 上传和预览测量，生成 JSON 与 Markdown 报告到 `work/`。可通过 `--out docs/performance/run.json` 指定报告路径。结果包含环境及原始样本，适合相同机器和浏览器之间对比，不作为跨设备的硬阈值。

## 配置登录账号

无需内网或外部身份服务即可验证服务器账号。密码从 stdin 输入，脚本只保存 scrypt 哈希，不输出密码/哈希，不覆盖已有账号：

```bash
read -s DTV_ACCOUNT_PASSWORD
printf '%s' "$DTV_ACCOUNT_PASSWORD" | node scripts/create-account.mjs --id admin --tenant customer-a --role admin --scenes xian,taiyuan --output deploy/auth/users.json
unset DTV_ACCOUNT_PASSWORD
AUTH_USERS_FILE="$PWD/deploy/auth/users.json" DEMO_ENABLED=false npm run dev
```

启用 `AUTH_USERS_FILE` 后，平台管理员可在“设置 → 用户管理”中新增登录账号、调整租户/角色/地区范围、停用账号或重置密码。账号变更会原子写回该 JSON 文件并即时生效；账号文件所在目录必须由 API 进程可写，建议仅授予服务账号访问权限。未配置该路径时，控制台只读并显示服务端配置提示。真实账号与业务演示用户是两套数据。

初始账号密码至少 12 字符；首次配置账号文件后启动 API。控制台创建、禁用和改密即时生效；改密或停用会使旧会话失效。账号配置文件已加入 Git 和 Docker 构建忽略规则，不能放入前端资源。会话有效期 8 小时，注销会撤销服务器会话。

Compose 使用时，在 `deploy/.env` 设置 `AUTH_USERS_FILE=/run/dtv-auth/users.json`，并为挂载的 `deploy/auth` 目录授予容器 node 用户（UID 1000）写权限，以支持管理员控制台原子更新。目录建议 700，账号文件 600。外部访问还需局方 TLS/证书及 `COOKIE_SECURE=true`。当前 Compose 是单层 Nginx，覆盖客户端转发头并显式信任 1 跳；不要在未经确认的多级代理环境直接沿用。

```bash
npm run test:postgres  # 需要 Docker；临时 PostgreSQL 16 容器验证，结束自动清理
```

## 工程结构

下面的目录树只列出主要源代码、配置和维护文档；`node_modules`、构建产物、临时报告和运行数据均未列出。

```text
digital-twin-visualization/
├── apps/                         # 可独立运行的前端、API 与后台任务进程
│   ├── web/                      # React 地图工作台、Cesium 地图与静态资源
│   │   ├── src/                  # 页面、地图交互、接口客户端和样式
│   │   └── public/               # 运行配置、图标、扩展目录和 Cesium 静态资源
│   ├── core-api/                 # NestJS API、认证授权、业务与数据访问
│   │   └── src/                  # 控制器、平台服务和持久化实现
│   └── worker/                   # PostgreSQL 任务队列后台执行进程
│       └── src/
├── packages/                     # 前端、API 与 Worker 共用的领域模块
│   ├── contracts/                # 场景、站点、图层和观测数据契约
│   ├── ingestion/                # 采集任务、连接器、仓库和指标
│   ├── sdk/                      # 地图扩展接口与图层运行时
│   └── plugins/                  # 示例插件及其构建入口
├── scenarios/                    # 西安、太原、成都等地区的演示场景
├── deploy/                       # Docker、Compose、Nginx 与服务器配置模板
│   ├── migrations/               # PostgreSQL/PostGIS 数据库迁移
│   ├── tianqing/                 # 天擎数据源配置示例
│   ├── auth/                     # 服务器账号配置目录（不提交真实账号）
│   └── README-offline.md         # 离线安装、升级与回滚手册
├── scripts/                      # 账号、迁移、备份恢复、打包和部署验证工具
├── tests/                        # 单元、契约及端到端测试
├── docs/                         # 架构、性能、计划和验收记录
├── package.json                  # npm 工作区、开发和构建命令
└── README.md                     # 项目说明与开发、部署入口
```

主要调用关系：`apps/web` 通过同源 HTTP API 调用 `apps/core-api`；API 与 `apps/worker` 共用 `packages/contracts`、`packages/ingestion` 等模块；Worker 从 PostgreSQL 队列领取采集任务，再通过连接器写入观测数据；地图与专题页面通过 API 查询场景、站点、图层和观测。`deploy/compose.yaml` 将 Web、API、Worker 和 PostgreSQL 组合为服务器部署单元。

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React 地图工作台、Cesium 可视化和浏览器端资源 |
| `apps/core-api` | NestJS 身份认证、租户/角色/场景授权、业务持久化与审计 |
| `apps/worker` | PostgreSQL 持久任务队列的后台执行入口与优雅退出 |
| `packages/ingestion` | 逐小时采集状态机、文件/数据库仓库、Mock 连接器、租约、重试、取消与原子入库 |
| `packages/contracts` | 场景结构、图层、站点、观测数据契约与演示数据 |
| `packages/sdk` | 受控地图接口、可取消图层生命周期和插件安装/卸载 |
| `packages/plugins` | 可独立构建的站点弹窗插槽插件示例 |
| `scenarios` | 西安、太原、成都等示例地区配置 |
| `deploy` | Compose、Dockerfile、Nginx、PostGIS 迁移与部署手册 |
| `scripts` | 数据库和文件成套备份/恢复、隔离部署验证及离线镜像导出 |
| `docs` | 已批准建设范围、实施计划、性能与验收记录 |

## 地图与现场配置

编辑 `apps/web/public/config.json`；Compose 使用 `deploy/config.json` 挂载。地图固定使用天地图卫星影像，不提供矢量或地形晕渲影像切换。`TDT_API_KEY` 保存在服务器 `deploy/.env`，由登录后的 API 配置接口交给浏览器端直连 WMTS 和三维高程服务 `mapservice/swdx`；高程瓦片在浏览器解压并解码为 Cesium 高程 Provider。浏览器端 Key 会出现在服务请求中，请在天地图控制台限制授权域名并允许实际访问页面的来源。地形启用 1.2 倍垂直夸张与场景光照。没有天地图 Key 时可使用配置的内网地形或 Cesium ion 后备地形；所有地形源不可用时保留平滑椭球并显示提示。`CESIUM_ION_ACCESS_TOKEN` 只用于 Cesium ion 后备地形，保存在服务器环境中，经登录保护且禁止缓存的 API 配置接口按需交给地图，并限制来源及资源权限。不要将任一令牌写入代码、静态配置或仓库。没有天地图 Key 时使用 Cesium 包内低精度本地底图；天地图署名保留。

内网 XYZ 示例（占位地址需要替换）：

```json
{"mode":"demo","basemap":{"type":"xyz","url":"/maps/base/{z}/{x}/{y}.png"},"terrainUrl":null,"notice":"内网底图"}
```

WMTS 使用 `type: "wmts"` 并配置 `url, layer, style, format, tileMatrixSetID`。本地反向代理 `/maps` 路径需在 Nginx 中增加到局方地图服务的授权映射；当前 nginx.conf 未预设客户地址。部署前核对 CRS、矩阵、覆盖级别、认证、跨域及证书。浏览器配置不得存放天擎凭据或长期敏感令牌。

## 项目图标资源

项目界面图标统一使用 `apps/web/public/iconfont.js` 提供的多色 SVG Symbol。`apps/web/src/Icon.tsx` 将页面中的语义名称映射到 Symbol；`apps/web/src/icons/iconfont.catalog.json` 保存完整图标目录。地图监测站的彩色标记由 `apps/web/src/stationIcons.ts` 按站点类型提取原始 SVG Symbol，并生成 Cesium Billboard 图像。更新图标集时替换 `iconfont.js` 和目录 JSON，并核对 `Icon.tsx` 与站点类型映射。

## API

除 health、auth/session 与登录入口外，业务接口需要有效 HttpOnly 会话。写入必须有 `X-DTV-Request: 1`，浏览器 Origin 必须匹配 Host。天擎适配器已实现但尚无真实账号联调；生产启动保护继续保留。

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
固定演示模式时次为 2026-11-07 00:00–12:00，UTC+8；入库模式时次从当前租户/场景/配置来源的观测库读取。图层 API 已消费采集入库资料；缺少指定时次返回 404，不生成替代资料。返回的 `storage` 区分 `generated` 与 `ingested`，来源分别显示 `mock` 或 `tianqing`。

## 无天擎时的采集与补数

进入 **系统管理 → 站点数据 → 采集与补数**：

1. 点击“采集最新时次”，或指定北京时间整点范围提交补数（含首尾，最多168小时）。
2. 任务逐小时提交观测与进度；5秒/10秒退避，当前小时连续3次失败进入失败队列。可以重试失败任务或取消未完成任务；已提交时次不会因后续失败回滚。
3. 管理员可开启每小时 Mock 计划，停机后最多自动追补最近24小时；更早资料手动补数。停用计划不会取消已有任务。
4. 预览入库观测，再勾选“使用入库观测”；地图、专题、摘要和趋势查询使用入库时次，空时次显示缺数。切换仅影响当前租户/场景。水位线表示最近成功小时，不表示较早资料连续无缺口；任务逐时进度用于定位未完成时次。

默认固定演示模式，**不会自动生成客户采集任务，也不会尝试连接天擎**。天擎适配层已在现有 TypeScript API/Worker 中实现，未启用的地区仍走 Mock；首期可采集逐小时地面要素，并沿既有任务、PostgreSQL、时次和地图查询链路工作。真实账号/接口尚未在项目环境联调。

## 天擎地区化接入

项目按现有 NestJS/TypeScript 架构实现 Java 方案中的无状态签名器和通用 HTTP Connector，不额外部署 Java 服务。各地区单独配置 endpoint、userId、password、serviceNodeId 和区划码；同类产品共享 profile。新增地区或调整账号、地址通常只改配置；接口参数或天擎字段名不同，也可通过新增 profile 和字段映射适配，不必改 Worker 主流程。

```bash
cp deploy/tianqing/sources.example.json deploy/tianqing/sources.json
chmod 600 deploy/tianqing/sources.json
# 编辑对应场景：将 enabled 设为 true，并替换 endpoint、userId、password、regionCode。
# 账号凭据和真实地址仅保存在服务器配置；更新后重启 API 与 Worker。
```

`sources.json` 已加入 Git 和 Docker 构建忽略规则，Compose 只读挂载到 API/Worker。每个 profile 配置 `interfaceId/dataCode/elements`、时间和区划参数、limitCnt、时区、空值标记及天擎字段到标准观测字段的映射。示例 profile 使用文档中的 `getSurfEleInRegionByTime / SURF_CHN_MUL_HOR`；上线前必须按局方账号实际返回的字段字典核对 `Datetime/Lon/Lat/TEM/PRE_1H/WIN_S_2MI`。一个任务只请求配置的小时点时次。

签名按原值、ASCII 参数名排序，将 pwd 仅加入 MD5 签名串并输出大写摘要；请求 query 采用 Python `quote_plus` 兼容编码，pwd 不发送。只重试网络错误、429、5xx，最多三次；业务错误、结构/时次/数值校验失败和达到 `limitCnt` 的疑似截断不会写入或推进水位。请求不跟随重定向、不记录完整 URL、签名或响应正文，响应上限为 10 MB。只有启用天擎的地区会把新任务来源设为 `tianqing`；来源字段由服务器配置决定，不信任浏览器提交值。

真实 endpoint、防火墙、签名对拍、字段单位/质量码和数据覆盖仍需客户网络及授权账号联调。首期仅完成小时地面要素；文档中的分钟/日值、雷达/卫星格点文件、FTP/SMB、预警 MQ 与出网 Outbox 仍未接入。字段映射不确定时先保持该地区 disabled，不要用模拟返回冒充生产采集。

开发文件模式由 API 内单进程执行器处理并保存 `DATA_DIR/ingestion.json`；每地区每产品最多保留1000个观测时次。不要启动多个 API 进程共用开发文件目录。PostgreSQL 模式由独立 Worker 执行，观测与进度在一个事务提交；数据库行锁和120秒租约令牌防止重复领取或旧执行器回写。单次连接器调用限30秒。API 和 Worker 启动前必须应用全部迁移（当前至006）。

每地区最多20个待完成任务，人工重试也受限；最多200条任务历史，优先淘汰已完成/已取消记录，失败任务保留处理。定时任务与同范围手动任务去重。采集配置按租户/场景隔离；写权限为 admin/editor，数据模式和定时计划仅 admin 可改。

- `GET /api/scenes/:id/ingestion`：任务、进度、水位、模式、计划
- `POST /api/scenes/:id/ingestion/jobs`：`{startTime,endTime}`，时次带时区且为整点；兼容的 source 字段会由服务端地区配置覆盖
- `POST /api/scenes/:id/ingestion/jobs/:jobId/retry`、`.../cancel`
- `PUT /api/scenes/:id/ingestion/config`：`{mode:"demo"|"ingested",enabled?:boolean}`，字段可分别提交
- `GET /api/scenes/:id/ingestion/observations?time=<ISO8601>`：直接预览入库结果，不受地图模式影响

升级已有 Compose 数据卷时，先构建/加载0.3.0镜像（不会自动重启旧容器），再成套备份、停止写入端并显式迁移（**不可删卷代替升级**）：

```bash
scripts/backup.sh /absolute/path/pre-0.3-backup
scripts/apply-migrations.sh
# 构建/加载0.3.0镜像后启动；健康检查会验证采集表存在。
docker compose -f deploy/compose.yaml up -d --no-build
```

旧观测的 scene_id 默认归入 xian，tenant_id 保持原值，不会迁给其他租户。现有队列状态来自新表，旧示例 ingest_job 保留但不再作为执行队列。开发文件模式完整备份需在 API 停止后保存整个 DATA_DIR（含业务、采集JSON及文件），Compose 备份脚本用于数据库部署。

## 插件发现与校验

宿主发现 `/extensions/catalog.json`，校验插件 ID、SDK API 主版本、入口限制、SHA-256 和 Ed25519 签名后才安装。“新电子沙盘”示例在 sandbox iframe 中运行，iframe 不授予 same-origin 权限，CSP 禁止网络连接，只能经窄消息协议调用地图门面、插槽与图层登记；卸载会清理注册项并销毁 iframe。`npm run build:plugin` 会在插件产物生成后签署清单并将公钥信任根编入宿主 bundle；私钥通过 `DTV_PLUGIN_SIGNING_KEY` 环境变量注入，不写入镜像或仓库。未提供环境密钥的本地构建使用临时密钥；正式发布应配置稳定、受控的构建密钥并妥善保管。签名信任构建产物，不替代许可证、组织审批或插件行为审查。

## 发布与业务实体

PostgreSQL 中站点、模型资源、书签、漫游方案和漫游点位已从关系实体表读取；JSONB 暂保留用户配置和兼容修订号。写入仍以 CAS 在单个事务内更新 JSONB 与实体表，004 迁移会回填旧数据。文件仓库通过不可变 revision bundle 分文件保存实体集合，原子切换 `platform.json` 指针；旧格式在首次读取业务资料时惰性迁移，原文件保留。系统管理“发布管理”仅管理员可将当前已保存修订固化为不可变快照；发布需另一位管理员审批，批准后可按稳定用户哈希设置 1–100% 灰度并激活。灰度外用户继续读取上一活动版本；没有旧版本时读取演示基线，不读取草稿。指定快照可恢复为新的草稿修订，校验附件引用并写审计；原发布快照不变。如果历史快照引用的附件已清理，恢复会安全拒绝。

Prometheus 可从 `GET /api/metrics` 抓取采集任务来源/状态计数和已启用计划数。指标不含租户、站点、产品、凭据或 endpoint 标签；该接口不要求登录，应仅在可信监控网络开放。采集任务、计划、水位和观测现按产品维度隔离，依赖任务自动入队且须等待上游时次成功。旧任务和历史观测由006迁移归入 `surface-hourly`。地面小时、雷达、卫星、风场、湿度、网格、预报、预警范围和自然环境模拟均可使用明确标记的确定性 Mock 数据创建任务、入库、查询和渲染；这些结果不是实况或正式预报/预警，后续可按产品替换 Connector。气象专题按透明 Mock 阈值展示站点级提示；设备页提供 Mock 遥测和状态刷新，不代表真实预警或设备链路。

## Docker 与离线交付

```bash
cp deploy/.env.example deploy/.env
# 修改 deploy/.env 的 POSTGRES_PASSWORD 为现场生成的随机密码
sudo chown 1000:1000 deploy/auth && sudo chmod 700 deploy/auth
# 使用容器内脚本初始化服务器管理员；密码从终端隐藏输入，不写入命令历史
read -s DTV_ACCOUNT_PASSWORD
printf '%s' "$DTV_ACCOUNT_PASSWORD" | docker compose -f deploy/compose.yaml run --rm --no-deps -T core-api node scripts/create-account.mjs --id admin --tenant customer-a --role admin --scenes xian,taiyuan,chengdu --output /run/dtv-auth/users.json
unset DTV_ACCOUNT_PASSWORD
cp deploy/tianqing/sources.example.json deploy/tianqing/sources.json
# 示例默认禁用天擎。需接入时替换地区账号/接口；Linux Compose 主机将文件组设为容器 node 的 GID 1000：
sudo chgrp 1000 deploy/tianqing/sources.json && chmod 640 deploy/tianqing/sources.json
# 在有依赖下载权限且架构匹配的构建机执行：
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml up -d
```

默认 Web 只监听 `127.0.0.1:8080`，适合由服务器 TLS 反向代理接入；需要直连时配置 `WEB_BIND_ADDRESS`/`WEB_PORT` 并设置防火墙。`.env.example` 默认关闭演示登录、开启 Secure Cookie，供管理员账号登录。API 与数据库不映射主机端口。核心 API 与 Worker 的 PostgreSQL 连接参数仅在容器环境注入。天擎配置目录只读挂载，若显式配置路径不存在则服务启动失败；示例禁用天擎时继续使用 Mock。Mock/天擎观测与水位线在一个事务中写入。数据库迁移仅在空卷首次初始化时执行，后续迁移必须显式管理。公网直连 HTTP 仅适合临时联调，正式使用应加 TLS。

```bash
scripts/backup.sh /absolute/path/new-backup-directory
# 备份会临时停止 web/core-api/worker，完成后恢复原先运行的服务。
# 留存当前备份后，显式覆盖数据库与全部服务器文件：
CONFIRM_RESTORE=yes scripts/restore.sh /absolute/path/backup-directory
# 恢复完成保持应用停止；检查后启动：
docker compose -f deploy/compose.yaml start core-api worker web
scripts/export-images.sh /absolute/path/offline-release
```

可运行 `scripts/package-offline-release.sh 0.3.0 /absolute/path/release` 构建离线包，其中包含指定版本的镜像归档、Compose、配置、迁移、运维脚本与 SHA256SUMS；`deploy/README-offline.md` 给出断网安装、升级、备份和恢复回滚步骤。升级先成套备份，停写后执行 `scripts/apply-migrations.sh`，迁移成功后再显式启动。脚本执行全量幂等迁移而非按编号账本追踪；迁移失败时需恢复备份。当前仍需在目标架构的隔离 Linux 现场实测镜像兼容、离线加载、升级与恢复；本地/模拟容器验证不替代现场验收。

备份目录含 `database.dump`、`files.tar.gz` 和 `SHA256SUMS`；两份数据必须成套恢复，脚本要求主机提供 bash、Docker Compose 与 shasum。账号文件、deploy/.env 和地图配置需另行加密备份。恢复校验失败不执行覆盖；恢复过程失败时应用保持停止，需用完整快照恢复后再启动。

回滚：保留上一版本镜像、配置和配套数据库/文件快照；停止写入后恢复快照与旧配置，加载旧镜像再启动。当前脚本不自动执行跨版本迁移回滚。

可在本机构建镜像后执行 `node scripts/verify-deployment.mjs`：脚本创建独立 Compose 项目、随机端口与卷，并对镜像操作使用 `--pull never`，验证代理上传、PostGIS/Worker 和成套备份恢复，然后清理测试资源。验证配置和迁移复制入容器/命名卷，避免依赖本机文件共享。脚本不主动断开主机公网；正式无公网验收须在网络隔离的目标环境按离线 runbook 执行。PostGIS 固定 amd64；ARM 主机使用模拟，仅作为本机集成证据，不等于正式 bind mount、目标架构与现场部署验收。实测范围见 [服务端文件验收记录](docs/verification/服务端文件验收记录.md)。

## 后续接入条件

1. 正式身份体系对接、许可证/套餐/数据集授权；文件容量配额、病毒扫描、跨实例一致性；发布审批结果仍需现场权限矩阵确认。
2. 天擎真实响应/字段单位质量映射、分页与上游限流；各气象产品真实数据格式与真实源 Connector；连续完整性检查和规模性能。产品级任务隔离、计划、水位、观测主键、依赖等待和 Mock 产品保护已实现。Prometheus 指标出口、任务恢复、补数与 API 查库已打通。
3. 内网天地图、地形与正式资源数据；设备真实协议、视频链路和数据清单。当前设备页为 Mock 遥测演示。
4. 正式气象风险算法与预警源；当前专题阈值仅为 Mock 提示，不能代替业务判断。
5. 完成目标架构镜像、断公网、内网地图/天擎链路、备份恢复、性能与升级回滚验收。

设计来源：[Figma 工作台](https://www.figma.com/design/2DzJheli9wLvLfhPkqgUBG?node-id=1784-23928) 与用户提供的总体技术方案。登录背景和图标从 Figma 下载到 `apps/web/public/design`，保留原文件；产品标识按用户要求使用统一项目名称。地图本身为 Cesium 动态渲染，不使用 Figma 地图截图。

0.3.0 的测试与已知边界见 [采集查询闭环验收记录](docs/verification/采集查询闭环验收记录.md)。
