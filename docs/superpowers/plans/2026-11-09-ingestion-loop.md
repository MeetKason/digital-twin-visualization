# 采集与查询闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Inline execution in the existing feature branch.

**Goal:** 无真实天擎时，使用标记清楚的 Mock Connector 完成任务、补数、失败重试、持久水位线、查询和页面操作。

**Architecture:** 共享采集服务及契约，PostgreSQL 是独立 Worker 的持久队列和观测库；开发文件模式由 API 内的单进程执行器处理任务，不支持多进程文件仓库。每个任务按小时提交观测与进度，租约令牌拒绝过期执行器的写入。按租户/场景隔离；源当前仅 mock。

**Tech Stack:** React/TS、NestJS、Node、PostgreSQL/PostGIS，沿用现有依赖。

## Global Constraints
- 仅参考新电子沙盘；在原有系统管理的站点数据栏目放操作入口，不另造设备/气象源。
- 天擎无接口和凭据，功能做成可替换 Connector，不尝试真实联网。source=mock 贯穿任务、数据库与 API。
- 新业务默认固定演示模式；切换入库模式后禁止缺数自动回退。
- 时次为带时区的整小时，单次补数最多168小时；每地区最多20个未完成任务、200条任务历史。
- 文件仓库仅开发 API 单进程；正式独立 Worker 使用数据库。旧观测增加 scene_id，不把旧 demo 租户数据混入新租户。

## Review Focus
- 重启/租约超时后从当前未成功小时恢复，旧执行器不能回写。
- 部分成功后失败不推进失败时次水位，人工重试不重复计数；早期补数不回退总水位。
- 同时领取同一任务只有一个有效租约；任务取消与成功提交竞争时引用同一锁。
- 只读拒写、跨租户/跨地区隔离、无效区间/未来时次/未知源拒绝；写入均校验来源。
- 入库模式下空时间轴/404/错误清楚展示；页面切换与异步刷新取消请求。

## Tasks
- [x] Contracts and queue: packages/contracts/src/ingestion.ts, packages/ingestion/src/{state,file,postgres,worker}.ts；先测逐时进度、失败、重试、租约、取消与幂等。
- [x] PostgreSQL migration 003：带 scene 的观测主键、队列状态；事务提交观测与进度，数据库锁领取。
- [x] Core API routes/auth/audit + development executor；真实 HTTP 验证作用域、模式切换、观测查询和重启。
- [x] Worker process：使用任务队列、连接器超时、退避重试、优雅退出；替换旧硬编码 demo/xian 循环。
- [x] UI：补数/采集最新、任务状态/重试/取消、数据预览和模式切换；地图动态时次与空数据处理。
- [x] 全检查、浏览器验证、独立审查、隔离 Compose/PostGIS 实测队列到 API 与备份恢复，更新文档和源码包。

自动周期调度采用显式启停的每小时计划；未启用时不自动创建客户任务。单进程文件执行器支持本机完整演示；多实例一致性由 PostgreSQL 行锁与租约处理。真实接口、质量单位映射、许可证与现场性能留待接入。
