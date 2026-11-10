# 天擎地区化采集适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使各地区通过服务端 JSON 配置天擎 endpoint、账号、口令和区划，即可将逐小时地面观测采入现有任务和地图查询链路。

**Architecture:** 沿用 NestJS/TypeScript 单体，在 `packages/ingestion` 加配置驱动的 signer/client/connector；由 API 和 Worker 共享只读配置并以场景路由。采集作业记录真实 source，继续复用当前 PostgreSQL/File store 的任务重试、租约与写入流程。

**Tech Stack:** TypeScript strict、Zod、Node fetch/WebCrypto-compatible node:crypto、现有 PostgreSQL/PostGIS 与 Vitest/Playwright。

**Spec:** `docs/superpowers/specs/2026-11-09-tianqing-adapter.md`

## Global Constraints

- 不新增 Java 服务，不将客户 endpoint 或密钥放进前端、仓库示例文件、日志或镜像。
- 未配置/禁用地区保持 Mock；天擎采集 source 由服务器地区配置决定。
- 所有新增采集代码提供中文注释；不记录完整 URL 或响应敏感内容。
- 错误或疑似截断响应不得写观测、推进水位或伪装成 Mock。

## Review Focus

- 参数原值与编码不一致：固定签名与 URL 编码用例。
- 账号或场景串用：双地区 endpoint/凭据路由测试。
- returnCode 错误、字段缺失、时次不匹配：拒写且不推进水位测试。
- 命中 limitCnt 静默截断：边界行数测试。
- 源切换后地图仍只查 Mock：状态、times/data API 与 UI 联测。

---

### Task 1: Signer、地区配置与天擎请求转换

**Files:**
- Create: `packages/ingestion/src/tianqing.ts`
- Create: `deploy/tianqing/sources.example.json`
- Modify: `.gitignore`, `.dockerignore`, `deploy/compose.yaml`
- Test: `tests/tianqing.test.ts`

- [x] 测试固定签名、encoding、配置 secrets、场景隔离、响应字段转换和异常响应。
- [x] 实现配置 schema、环境/文件加载、无状态签名器、脱敏/安全 HTTP 请求与字段映射。
- [x] 运行 `npx vitest run tests/tianqing.test.ts`。

### Task 2: 采集 source 贯穿任务状态与存储

**Files:**
- Modify: `packages/contracts/src/ingestion.ts`
- Modify: `packages/ingestion/src/state.ts`, `file.ts`, `postgres.ts`, `worker.ts`
- Modify: `apps/core-api/src/platform/platform.ts`, `apps/worker/src/main.ts`
- Test: `tests/ingestion.test.ts`, `tests/worker.test.ts`

- [x] 添加 Tianqing source 和地区来源解析；人工、计划任务均使用服务端已配置来源。
- [x] Worker 按 source 路由 Mock/Tianqing connector；数据库查询按来源过滤。
- [x] 回归租户隔离、Mock 和 Tianqing 拒写/重试/水位。

### Task 3: API、UI 与运维配置文档

**Files:**
- Modify: `apps/core-api/src/ingestion.controller.ts`, `apps/core-api/src/app.ts`
- Modify: `apps/web/src/business/IngestionPanel.tsx`, `packages/contracts/src/index.ts`
- Modify: `deploy/.env.example`, `README.md`, `deploy/README-offline.md`
- Test: `tests/platform-http.test.ts`, `tests/e2e.spec.ts`

- [x] 采集状态、安全来源说明、时次与数据 API 使用 active source。
- [x] 前端显示当前 source，作业请求由服务端地区配置覆盖客户端值。
- [x] 写明按地区配置、文件权限、服务重启、首个 profile 映射和真实 endpoint 验收方法。
- [x] 运行 `npm run check`、`npm run test:e2e`、`npm run test:postgres` 及隔离 Compose 部署演练。
