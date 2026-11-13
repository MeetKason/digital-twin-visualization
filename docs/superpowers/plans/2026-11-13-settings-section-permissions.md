# 系统管理子菜单授权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让场景包和账号共同限定系统管理子菜单，并同步保护管理接口。

**Architecture:** 共享契约定义子菜单 ID；场景包和账号分别存储可选授权；服务端计算交集并返回地区可见配置。平台最高管理员绕过限制。

**Tech Stack:** TypeScript、NestJS、React、Ant Design、Vitest、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-13-settings-section-permissions-design.md`

## Global Constraints

- 既有配置保持可读，现有角色权限只可收窄。
- 管理 API 必须在服务端校验，不能只隐藏菜单。
- 新 UI 复用 Ant Design。

## Review Focus

- 空授权应隐藏系统管理入口。
- 非最高管理员直接请求受限 API 应返回 403。
- 发布场景包或更改账号授权后，新会话权限应更新。
- 旧场景包与旧管理员账号应保持原行为。

---

### Task 1: 共享契约与权限计算

**Files:** `packages/contracts/src/management.ts`, `packages/contracts/src/scene.ts`, `packages/contracts/src/scenario.ts`, `tests/settings-permissions.test.ts`

- [x] 先写交集、空集合、旧配置、最高管理员的失败测试。
- [x] 实现子菜单 ID、校验和交集函数。
- [x] 运行对应单元测试。

### Task 2: 账号和服务端鉴权

**Files:** `apps/core-api/src/platform/auth.ts`, `apps/core-api/src/platform/platform.ts`, `apps/core-api/src/platform/scenarios.ts`, `apps/core-api/src/app.ts`, `apps/core-api/src/ingestion.controller.ts`, `tests/settings-permissions.test.ts`

- [x] 先写受限账号获取场景及直接调用管理接口的失败测试。
- [x] 将账号授权持久化并加入会话动态解析；场景列表返回交集。
- [x] 对账号、场景包、发布、审计和采集管理接口加对应校验。
- [x] 运行服务端测试。

### Task 3: Ant 配置界面与回归

**Files:** `apps/web/src/business/ScenarioManager.tsx`, `apps/web/src/business/AccountManagement.tsx`, `apps/web/src/business/SettingsPage.tsx`, `apps/web/src/Workbench.tsx`, `tests/e2e.spec.ts`

- [x] 补充受限账号菜单及配置表单的浏览器回归。
- [x] 增加两个多选配置，依据服务端交集过滤系统管理目录。
- [x] 运行浏览器回归和 `npm run check`。
