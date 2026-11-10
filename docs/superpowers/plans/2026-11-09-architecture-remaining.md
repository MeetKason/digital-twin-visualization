# 架构剩余功能实施计划

> **For agentic workers:** 按模块并行实施；执行者必须先读关联设计并以失败测试开始。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成本地环境可验证的文件实体化、发布审批激活、多产品采集与 Prometheus 指标、签名插件沙箱。

**Architecture:** 文件仓库按 revision bundle 原子切换；发布在 immutable snapshot 上走二人审批；采集以 product 作为持久任务维度；插件以 Ed25519 信任根和 sandbox iframe 隔离。

**Tech Stack:** TypeScript strict、NestJS、React、Zod、PostgreSQL/PostGIS、Vitest、Playwright、WebCrypto Ed25519。

**Spec:** `docs/superpowers/specs/2026-11-09-architecture-remaining-design.md`

## Global Constraints

- 业务租户始终从服务端会话解析；不得信任客户端 tenantId。
- 插件只能调用 SDK 暴露能力，不可取得宿主 Cesium Viewer 或 DOM。
- 采集无真实来源时必须显式标为 Mock/未接入，不生成伪实时产品数据。
- 不将凭据、租户 ID、endpoint 写入 Prometheus 输出。
- PostgreSQL 任务与业务状态修改遵循现有事务、CAS、租约与审计约束。

## Review Focus

- 文件迁移和写入中断不能暴露部分 revision：覆盖旧格式惰性迁移、并发更新和原子指针。
- 发布流中的自审批/跨租户/过期动作拒绝：覆盖权限、revision 和 immutable snapshot。
- 多产品同小时任务不可相互去重或覆盖水位：覆盖 product 范围隔离和旧客户端兼容。
- Prometheus 输出不能带高基数或敏感标签：覆盖标准格式与标签白名单。
- 签名/沙箱边界不能被 manifest 或插件脚本绕过：覆盖篡改、未知 key、iframe origin 与卸载清理。

---

### Task 1: 文件仓库实体持久化与兼容迁移

**Files:** `apps/core-api/src/platform/repository.ts`, `tests/platform.test.ts`, `tests/publication.test.ts`.

- [x] 先添加测试：从旧 `platform.json` 读取并惰性实体化；revision bundle 存取各实体集合；并发 CAS 写入只呈现一个完整修订；旧内嵌数据保留。
- [x] 实现 bundle + 原子 scope pointer；保持 Repository 接口与租户隔离。
- [x] 运行相关 FileRepository 测试和 `npm run check`。

### Task 2: 发布审批、激活与活动版本读取

**Files:** `packages/contracts/src/business.ts`, `apps/core-api/src/platform/repository.ts`, `apps/core-api/src/platform/platform.ts`, `apps/core-api/src/app.ts`, `apps/web/src/api.ts`, `apps/web/src/business/PublicationPage.tsx`, `tests/platform-http.test.ts`, `tests/publication.test.ts`, new migration `005_publication_workflow.sql`.

- [x] 先添加 API/存储测试：提交待审、拒绝、二人审批、活动版本原子切换、viewer active snapshot、draft 保持不变及租户隔离。
- [x] 为 file/PostgreSQL repository 实现有审计的状态转移和 active pointer；迁移须幂等并保留既有发布记录。
- [x] 实现只读 viewer 获取活动快照、管理员界面操作和状态提示。
- [x] 运行 API、Postgres 迁移和发布流程验证。

### Task 3: 多产品任务维度与 Prometheus 指标

**Files:** `packages/contracts/src/ingestion.ts`, `packages/ingestion/src/state.ts`, `file.ts`, `postgres.ts`, `worker.ts`, `health.ts`, `apps/core-api/src/ingestion.controller.ts`, `apps/core-api/src/app.ts`, `apps/web/src/api.ts`, `apps/web/src/business/IngestionPanel.tsx`, migration `006_ingestion_products.sql`, tests.

- [x] 先添加失败测试：同 tenant/scene/time 的不同 product 独立排队/水位/重试；缺省 product 兼容原行为；unsupported product 不伪造观测。
- [x] 增加产品注册表、持久 productId、产品级进度/计划/观测隔离和依赖入队；旧任务/客户端迁为 `surface-hourly`。
- [x] 暴露 Prometheus text format；只输出来源/状态与计划计数，不输出 tenant、endpoint、credentials。
- [x] 添加产品选择和未接入状态；运行文件仓库、PostgreSQL 迁移与 HTTP/browser 契约验证。

### Task 4: Ed25519 插件签名与 iframe 沙箱

**Files:** `packages/sdk/src/pluginManifest.ts`, `packages/sdk/src/index.ts`, `apps/web/src/useExtensions.ts`, `apps/web/src/Workbench.tsx`, `apps/web/vite.config.ts`, plugin build scripts, extension host UI, tests.

- [x] 先添加失败测试：有效签名可加载；篡改、未知 key、无签名拒绝；插件只在无 same-origin sandbox iframe 中运行；卸载终止执行上下文。
- [x] 创建私钥环境变量签名流程和构建公钥 trust root；绝不将私钥打包。
- [x] 把现有插件样例迁到窄消息协议；保留安装、卸载和哈希验证。
- [x] 运行 SDK/host 测试及浏览器沙箱集成验证。

## 总体验收

- [x] `npm run check`
- [x] `npm run test:e2e`
- [x] `npm run test:postgres`
- [x] `git diff --check`，离线源码包清单排除真实天擎配置与密钥；正式数据产品连接器与目标环境验收仍待接入。
