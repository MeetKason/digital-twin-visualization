# 操作审计只读控制台实施计划

## 目标与技术

在 React 设置页中展示现有 `/api/audit` 响应，按租户隔离，只读，可筛选和导出 CSV。沿用现有 React、TypeScript、CSS 与 Playwright。

## 全局约束

- 不引入新依赖，不改 Figma 参考范围，不连接真实天擎。
- 服务端会话和租户范围仍是数据授权依据；浏览器筛选只影响展示。
- 不显示或导出密码、凭据或哈希。

## 实施步骤

1. 在 `tests/e2e.spec.ts` 增加审计页浏览、筛选和 CSV 导出的失败用例，先确认其因入口缺失而失败。
2. 新建 `apps/web/src/business/AuditLogPage.tsx`，加载 `/api/audit`，按日期倒序渲染，支持文本/结果筛选、刷新、空态、错误态和 CSV 导出。
3. 在 `apps/web/src/business/SettingsPage.tsx` 添加“操作审计”菜单并挂载页面，补充小屏表格样式。
4. 跑目标 Playwright 用例、项目 `check` 和全量浏览器回归；更新架构待办与源码包。
