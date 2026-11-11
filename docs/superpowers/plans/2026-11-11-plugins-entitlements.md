# 插件扩展与租户产品授权实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补齐三个插件扩展点与离线可运行的租户产品授权闭环。
**Architecture:** 声明式插件注册及Provider异步桥沿用签名沙箱；授权契约与验证服务共用配置CAS，核心API和Worker执行相同策略。
**Tech Stack:** TypeScript、React/Ant、NestJS、Ed25519、PostgreSQL。
**Spec:** docs/superpowers/specs/2026-11-11-plugins-entitlements.md

## Global Constraints

保留当前未提交工作；本地当前功能分支直接推进，不迁移/清理用户数据。不部署、不推送。中文注释/README；不输出密钥，默认离线，演示显式Mock。

## Review Focus

- 无许可证或可信根配置错误时生产拒绝业务，但保留授权修复入口。
- 过期/吊销后，既有采集任务也不能绕过产品权限。
- 局方管理员不可跨租户/超自身地区分配账号或签发授权。
- 隐藏业务集合不能因保存可见部分丢失，直接伪造修改应拒绝。
- 插件失败和卸载不得移除其他插件资源，快速切换不得残留iframe或Provider请求。

## Tasks

- [x] 1. `packages/contracts/src/licensing.ts`、`platform/licensing.ts`、`tests/licensing.test.ts`：先红灯验证签名/套餐/时间/CAS/隔离，实施状态/导入/吊销及离线签发工具。
- [x] 2. `platform.ts`、`app.ts`、`ingestion.controller.ts`、Worker、HTTP测试：授权过滤/校验、账号管理员边界、业务集合保护和后台任务校验；保持管理修复入口。
- [x] 3. `TenantAuthorization.tsx`、Workbench/Settings/api：Ant查看和导入/吊销、模块导航交集与恢复入口；浏览器测试角色和产品禁用。
- [x] 4. `sdk/extensions.ts`、`pluginSandbox.ts`、`useExtensions.ts`、MapView：先测试声明与数据校验，补菜单/Widget/Provider、所有权、取消和失败清理。
- [x] 5. 示例插件、独立后端模板、中文README：展示三个扩展点、不新增在线依赖，验证安装/显示/取数/卸载、模板鉴权和越权拒绝。
- [x] 6. 执行check、PostgreSQL、全量浏览器回归、截图检查和自检；更新验收记录和未完成项。

## 执行记录

用户已持续授权按设计直接执行，使用当前功能分支保留之前所有改动，不另建会遗漏未提交实现的工作树。不创建提交或推送。每项以测试证据更新本记录。


1–5项已实现：签名许可证、API/Worker授权、账号边界、Ant管理入口、沙箱扩展与服务端逻辑数据集映射、独立后端模板。现有功能分支未清理或提交用户改动。

验证进度：check通过（35个测试文件、103项）；PostgreSQL验证包括跨实例证书导入与吊销，临时容器已移除；全量28项浏览器通过（约4.5分钟），随后4项生命周期/授权测试与2项截图检查复测通过。自检补充服务端演示授权标记，Worker不再凭租户前缀放行；外部Provider遵守连接取消及1MB响应限制。


完成记录：`npm run check`最终通过（35文件、103项、类型/Lint/Web/API/Worker构建），`npm run test:postgres`通过（签名、跨实例授权、吊销、重放拒绝和审计），`git diff --check`、Shell与模板语法检查通过。已检查插件页面/Widget/Provider与授权页截图。离线包结构测试使用Docker替身，不表示已构建并现场验收整套离线镜像。补齐公钥/SDK/后端模板打包，保留production启动闸门；扩展与许可证均未部署或推送。

自检补充：失败许可证写请求与越权管理写入审计；业务历史回滚同样检查隐藏集合授权，不能绕过普通保存保护。真实客户接口、商业计费/硬件绑定/防时钟回拨、站点字典与设备联动不在本轮完成声明中。
