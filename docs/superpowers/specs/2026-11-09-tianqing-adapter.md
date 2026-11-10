# 天擎地区化采集适配设计

## 目标

在现有 NestJS/TypeScript 采集链路内实现可配置的天擎适配层。新增地区主要通过服务器配置填写自己的接口地址、userId、pwd 和区划码即可复用既有采集与地图流程；账号不进入前端、日志或镜像。

## 范围

- 使用 Java 方案中的无状态 MD5 大写签名、原值签名/表单编码、serviceNodeId、interfaceId、dataCode、times 等协议约束。
- 通过场景到天擎配置的映射选择地区凭据和 endpoint；通过共享产品 profile 定义接口参数、字段映射和时区。
- 首个纵向链路支持逐小时地面要素：请求、响应校验、观测转换、现有任务租约/重试、入库、地图查询。
- 未配置或禁用天擎的地区继续使用 Mock；启用地区由服务端决定采集源，客户端不能伪造来源。
- HTTP 请求使用超时信号、429/5xx/网络错误有限指数退避；业务拒绝和结构错误不重试。禁止记录完整 URL、签名、口令和响应正文。
- 以本地 Mock HTTP 服务测试协议，不向真实客户 endpoint 发请求。
- 新增/修改的采集逻辑用中文注释说明协议细节、配置关系和安全约束。

## 非目标

- 不新增 Java/Spring Boot 服务，不复制另一套采集调度器。
- 不在无真实字段字典的情况下猜测雷达/格点/预警产品映射；首版之外的产品通过 profile 扩展。
- 不实现 FTP/SMB、RabbitMQ、出网 Outbox、格点加工或终端发布。本期请求范围聚焦于地区天擎账号/地址配置及要素观测采集。
- 不在浏览器配置中提供密钥，不把前端代理作为天擎凭据持有者。

## 配置

`deploy/tianqing/sources.json` 是仅服务端挂载的实际配置（Git 忽略、Docker build context 排除、Compose 只读挂载）；仓库只提供无凭据的 `sources.example.json`。每个 scene 提供 `enabled/baseUrl/userId/password/serviceNodeId/regionCode/profile`。profile 提供 `interfaceId/dataCode/elements/timeParameter/limitCnt/timeZone/fieldMap` 及业务参数。地区新增只需复制一个 scene 配置并填账号、口令、地址、区划码；同类接口继续复用 profile。

## 安全与失败边界

- endpoint 仅允许配置的 HTTP(S) URL，拒绝 userinfo、query 和 fragment；禁止跟随跨主机重定向。
- 天擎 pwd 仅参与签名，不作为 query parameter 发送；参数对象不可变复制，避免口令污染后续请求。
- 用原始业务参数排序签名，再按 Python quote_plus 兼容规则编码 query；`~` 编码差异需回归测试。
- 命中 `DS.length >= limitCnt` 视为可能截断，拒绝推进水位并进入现有重试/失败流程，不静默丢数。
- 响应 `returnCode != 0`、错误 JSON、字段映射缺失、时次不匹配、数值越界均失败且不推进水位。
- 失败详情仅写通用脱敏错误，服务端日志只允许输出地区、profile、interfaceId、耗时、状态码/行数。

## 验收

1. 固定参数签名、中文/逗号/星号/波浪号 URL 编码测试。
2. 场景配置隔离测试：不同地区分别使用 endpoint/user/pwd/区划码；禁用配置回退 Mock。
3. HTTP 200 映射、429/5xx retry、4xx 不重试、超时取消、错误业务码、空 DS 和截断检测。
4. Tianqing job 从 enqueue 到观测存储与 layer data 查询的本地集成测试；来源为 `tianqing`。
5. 无配置的现有 Mock 路径保持通过。

真实账号联调、客户字段/质量码核验和端网策略验证仍需目标环境完成。
