# 数字孪生可视化系统

React / TypeScript / Cesium 地图工作台，NestJS API，PostgreSQL 任务 Worker。版本 **0.3.0**。

当前可部署为 Mock / 演示实例。观测和天气产品使用确定性 Mock，并标明来源。真实气象、设备和正式预警尚未接入，本版本不能作为生产验收。

## 功能

| 菜单 | 能力 |
| --- | --- |
| 总览地图 | 图层、搜索、三维浏览、测量、书签、雨雪雾视觉模拟、时间轴 |
| 路径漫游 | 方案编辑、站点或地图节点、相机参数、播放控制 |
| 点位管理 | 站点维护、CSV 导入导出、模型 / 视频 / PDF、Mock 观测 |
| 气象专题 | 专题与地图、站点、指标联动；只展示可追溯的 Mock 观测 |
| 设备监控 | Mock 在线状态与告警定位；真实设备协议待接入 |
| 系统管理 | 账号、许可证、场景包、插件、发布审批、审计、采集与补数 |

## 本地开发

需要 Node 22.20.0（最低 22.12）和 npm 10。

```bash
npm ci
npm run dev
```

打开 http://127.0.0.1:5173 ，点击「进入演示系统」。API：http://127.0.0.1:3001/api/health 。服务只监听本机。

```bash
npm run check          # 类型、Lint、测试、生产构建
npm run smoke:built    # 先 build，再做 API 冒烟检查
npx playwright install chromium && npm run test:e2e
npm run test:postgres  # 需要 Docker；临时 PostgreSQL，结束自动清理
```

端到端测试也可使用本机 Chrome：`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`。

`npm run build` 输出前端到 `apps/web/dist`，服务端到 `dist/server`。Cesium 延迟加载，登录首屏不带地图引擎。

开发数据默认写在 `apps/core-api/.data/platform.json`。配置 `DATABASE_URL` 或 `PG*` 后改用 PostgreSQL。独立 Worker 必须使用 PostgreSQL；文件模式由 API 单进程执行。

```bash
WORKER_ONCE=1 npm run worker
```

## 登录账号

密码从标准输入读取，脚本只保存 scrypt 哈希，已有账号保持不变。

```bash
read -s DTV_ACCOUNT_PASSWORD
printf '%s' "$DTV_ACCOUNT_PASSWORD" | node scripts/create-account.mjs \
  --id admin --tenant customer-a --role admin --scenes xian,taiyuan \
  --output deploy/auth/users.json
unset DTV_ACCOUNT_PASSWORD
AUTH_USERS_FILE="$PWD/deploy/auth/users.json" DEMO_ENABLED=false npm run dev
```

配置 `AUTH_USERS_FILE` 后，管理员可在「设置 → 用户管理」维护账号。账号文件已忽略，不进入 Git 和镜像。会话 8 小时；改密或停用后旧会话失效。角色为 admin、editor、viewer。写入以服务器会话决定租户。

## 当前服务器

- 主机 `162.14.107.55`，目录 `/home/ubuntu/dtv-visualization`，Compose 项目 `dtv`。
- 页面 http://162.14.107.55:18087 。API 与 PostgreSQL 不映射公网端口。
- 数据源为 Mock。当前入口是 HTTP，供联调使用；正式访问前配置 HTTPS，并保持 Secure Cookie。
- 初始密码在部署机 `work/deploy-secrets/server-admin-password.txt`。首次登录后立即更换。该文件留在部署机。
- 更新：工作区干净且与远端提交一致时，在仓库根目录执行 `bash scripts/deploy-server.sh`。预检失败保持旧版本；切换失败恢复旧镜像，并保留数据库和文件卷。
- 重新部署前先备份，并保留 `dtv_postgres-data` 与 `dtv_platform-files`。安装、升级和回滚见 [离线交付手册](deploy/README-offline.md)。

## 工程结构

```text
apps/web          React 工作台与 Cesium
apps/core-api     NestJS API、会话、持久化、审计
apps/worker       PostgreSQL 任务队列
packages/         contracts、ingestion、sdk、plugins
scenarios/        西安、太原、成都等场景 JSON
deploy/           Compose、Nginx、迁移、离线手册
extensions/       客户后端扩展模板
scripts/          账号、备份、部署、校验
tests/  docs/     测试、架构与验收记录
```

前端经同源 API 调用 core-api。API 与 Worker 共用 `packages`。`deploy/compose.yaml` 组合 Web、API、Worker 和 PostgreSQL。

## 开发约定

- 业务界面优先使用 Ant Design，并复用 `apps/web/src/ui/controls.tsx`。
- Cesium Viewer 只放在 `apps/web/src/MapView.tsx`；插件只调用 `@dtv/sdk`。
- 地区差异写在 `scenarios`，公共契约放在 `packages/contracts`。
- 默认使用离线资源。地图 Key、天擎凭据和许可证私钥只放服务器环境。
- Mock、缺数、延迟和失败都按实际状态展示，缺数不补成实况。
- 模型、视频和 PDF 存在受控文件卷，按租户和场景授权。数据库与文件卷成套备份。

地图配置在 `apps/web/public/config.json`，Compose 使用 `deploy/config.json`。天地图 Key 写在 `deploy/.env` 的 `TDT_API_KEY`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [离线交付手册](deploy/README-offline.md) | 安装、升级、备份、回滚、许可证挂载 |
| [架构完成度与待办](docs/architecture/架构完成度与待办.md) | 已实现能力与未完成项 |
| [采集查询闭环验收](docs/verification/采集查询闭环验收记录.md) | 0.3.0 测试与已知边界 |
| [演示准备与验收](docs/verification/演示准备与验收.md) | 演示资料与现场验收 |
| [服务端文件验收](docs/verification/服务端文件验收记录.md) | 文件卷与部署验证范围 |
| [后端扩展模板](extensions/backend-template/README.md) | 客户独立后端 |
| [许可证载荷示例](docs/examples/tenant-license-payload.json) | 离线签发载荷 |
| [西安场景包示例](docs/examples/xian-scenario-pack.json) | 运行时场景包 |

界面只对齐 [Figma 新电子沙盘](https://www.figma.com/design/2DzJheli9wLvLfhPkqgUBG?node-id=1784-23928)。
