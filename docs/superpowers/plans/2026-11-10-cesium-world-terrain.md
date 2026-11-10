# Cesium World Terrain 实施计划

> **执行提示：** 实施时逐项执行本计划，并按任务检查结果。

**目标：** 固定天地图卫星影像、移除底图切换控件，并在配置 Cesium ion 令牌时启用 Cesium World Terrain 真实高程。

**架构：** 服务端从环境变量读取 Cesium ion 令牌，并通过现有的登录保护配置接口提供给地图页面；地图优先使用已配置的内网 `terrainUrl`，否则使用 Cesium World Terrain。无可用地形源或加载失败时保留椭球地图并显示明确状态。

**技术栈：** React、TypeScript、CesiumJS、NestJS、Docker Compose。

**设计稿：** `docs/superpowers/specs/2026-11-10-cesium-world-terrain-design.md`

## 全局约束

- 浏览器端不内置任何长期令牌；Cesium ion 令牌只从已登录 API 配置接口按需读取。
- Cesium ion 令牌必须采用最小权限，并将允许站点来源限制为实际部署域名。
- 默认底图为天地图 `img_w`，保留天地图版权署名。
- 不将矢量底图或 `ter_w` 地形晕渲影像提供为底图切换选项。
- 地形服务失败时不阻断卫星地图初始化，界面须提示真实地形未加载。
- 用户要求 README 使用中文；新增文档说明使用中文，代码/API 名称保持原样。

## 重点检查情形

- 未设置 Cesium ion 令牌：不发起 ion 请求，地图保持椭球并说明缺少配置。
- 配置无效令牌或网络不可达：卫星地图仍可交互，错误提示说明地形不可用。
- 配置内网 `terrainUrl`：优先加载该服务，不使用 Cesium ion 令牌。
- 天地图 Key 缺失：按现有设计回退本地底图，不因地形配置导致地图初始化失败。
- 底图 UI 移除后：原地图坐标、测量、图层和时间轴控件仍正常显示。

---

### Task 1: 配置与保护 Cesium ion 令牌

**文件：**
- 修改：`apps/core-api/src/app.ts`
- 修改：`apps/web/src/api.ts`
- 修改：`deploy/compose.yaml`
- 修改：`deploy/.env.example`
- 修改：`README.md`
- 修改：`deploy/README-offline.md`

**接口：**
- `GET /api/display-config` 保持会话认证，返回 `cesiumIonAccessToken: string | null`，不记录令牌。
- `RuntimeConfig` 增加可选 `cesiumIonAccessToken?: string`；静态 `config.json` 不存令牌。
- API Compose 环境变量从 `CESIUM_ION_ACCESS_TOKEN` 注入。

- [x] 将服务端配置接口和 Web 运行时配置类型改为读取 ion 令牌；验证未设置时返回 `null`。
- [x] 在 Compose 和环境变量示例中加入令牌占位配置及域名限制说明，确认 `.env` 仍被 Git 忽略。
- [x] 更新中文项目和离线部署文档，说明令牌权限、域名约束及在线服务依赖。
- [x] 更新 Nginx 来源策略为 `strict-origin-when-cross-origin`，向 Cesium ion 提供授权来源 Origin。

### Task 2: 固定卫星影像并移除底图切换

**文件：**
- 修改：`apps/web/src/MapView.tsx`
- 修改：`apps/web/src/tianditu.ts`
- 修改：`apps/web/src/styles.css`

**接口：**
- 天地图 Provider 固定使用 `img_w` 和运行时天地图浏览器 Key。
- 移除未再使用的底图类型、选项、切换状态、切换函数和按钮样式。

- [x] 保持地图启动时加载 `img_w`，去掉矢量/卫星/地形三按钮及相关 CSS。
- [x] 确认天地图署名和既有地图功能控件不受影响。
- [x] 将气象格网、站点标记、测量图形和示例范围线贴合地形，避免山体遮挡。

### Task 3: 启用真实地形并处理失败

**文件：**
- 修改：`apps/web/src/MapView.tsx`

**接口：**
- 使用 Cesium `createWorldTerrainAsync()` 创建 Cesium World Terrain。
- 若配置 `terrainUrl`，使用现有 `CesiumTerrainProvider.fromUrl()`；否则在存在 ion 令牌时设置 `Ion.defaultAccessToken` 并加载 Cesium World Terrain。

- [x] 内网 `terrainUrl` 优先；没有内网地址且令牌存在时，在后台加载 Cesium World Terrain，并开启 `globe.depthTestAgainstTerrain`；保持原有光照设置不变。
- [x] 无令牌时不访问 ion，状态提示当前显示椭球。
- [x] 地形初始化有 15 秒超时，失败时保留已有底图、图层和测量工具并提示真实地形未加载。
- [x] 处理 `CesiumTerrainProvider.errorEvent` 的最终瓦片错误并清理监听器。

### Task 4: 静态验证与部署

**文件：**
- 构建产物：`apps/web/dist`、`dist/server`（不提交临时产物）
- 部署：服务器 `/home/ubuntu/dtv-visualization/.env` 与 Docker Compose 容器

- [x] 执行 `npm run typecheck`、`npm run build` 和 `git diff --check`。
- [x] 检查静态打包文件不包含 ion 令牌，确认 `.env` 未被 Git 跟踪。
- [ ] 构建 `linux/amd64` 镜像并部署，确认 Web/API 健康检查通过。
- [x] 确认部署版仅显示卫星底图；没有令牌时保留地图并提示椭球回退。
- [ ] 配置有效 Cesium ion 令牌后，在浏览器确认地形起伏、图层贴地显示和测量交互。
