# 架构剩余功能实施设计

## 意图

补齐当前可在本地开发环境落地的四项能力：文件仓库实体化、发布审批与激活、Prometheus 采集指标及多产品调度、插件签名信任与沙箱执行。继续沿用现有 TypeScript/NestJS、PostgreSQL 和 React 项目，不引入第二套服务。

## 目标与边界

- 文件仓库将业务实体拆到租户/场景/修订范围内的独立数据文件，并通过单一原子指针切换修订；兼容升级前的 `platform.json`。
- 发布由管理员提交审批，另一管理员审批，通过后显式激活；只读用户看到活动版本，草稿和发布快照保持独立。
- 采集任务以产品维度排队/去重/展示；首版产品统一映射到既有观测契约，尚无实际字段规范的产品只接受明确标注的 Mock Connector，不伪造生产数据。Prometheus 指标不包含租户、凭据或完整 endpoint。
- 插件必须由受信任 Ed25519 公钥验证签名，并在 sandbox iframe 中运行，通过受限消息协议接入宿主；未签名插件不安装。
- 真实身份源、真实天擎产品、真实发布审批组织矩阵、生产签名密钥、目标机隔离验收不由本地实现替代。

## 决策

1. 文件仓库保留 `platform.json` 作为会话/审计/兼容迁移源，业务数据按 scope 写到不可变 revision bundle；原子更新 scope pointer 后新修订可见。启动/读取时遇到旧内嵌 business 记录会惰性迁移，不删原文件。
2. 发布流程使用 `draft → pending_approval → approved → active` 状态。提交者不能审批自己的快照；只有 admin 可提交/审批/激活；激活每个 tenant/scene 至多一个活动版本。拒绝会保留理由和历史，不改写 snapshot。
3. 每个 job 增加 `productId`，不把产品身份编码进 sceneId。缺省产品兼容现有 `surface-hourly`；唯一约束、计划任务、API 和 UI 均以 tenant/scene/product/source/time 作为范围。
4. Prometheus 提供独立只读 `/metrics` exposition，以聚合后的有限标签统计作业状态/计数与进程健康，不输出账号、租户 ID、站点号或 endpoint。
5. 插件私钥只从构建环境注入；仓库保留可配置的公钥信任根。插件 iframe 不使用 `allow-same-origin`，只向宿主调用经 SDK 白名单化的能力。

## 验收

- 旧文件状态读取后实体数据一致；并发修订保存不会出现半写，用户/租户间不能读到其他 bundle。
- 发布未获审批不能激活；自审批、跨租户审批和过期操作拒绝；激活后 viewer 读取该快照，原 draft/published snapshots 不变。
- 多产品任务独立去重/重试/进度，旧客户端缺省 product 行为兼容；无真实 Connector 的产品显式报未接入。Prometheus 文本格式可解析且不泄露高基数/敏感标签。
- 篡改签名、未知 key、过期/错误格式插件不能运行；有效签名插件只在 sandbox iframe 执行，卸载能终止 iframe 并释放宿主订阅。
