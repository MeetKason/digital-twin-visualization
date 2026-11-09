# Digital Twin Visualization

- 核心前端 React/TypeScript + Cesium，服务端 NestJS；保持 TypeScript strict。
- Cesium Viewer 仅允许出现在 apps/web/src/MapView.tsx；插件只调用 @dtv/sdk。
- 公共契约在 packages/contracts；地区差异写 scenarios JSON，不复制页面。
- 默认离线资源；禁止 Cesium ion、CDN、前端生产凭据、硬编码客户接口。
- mock 数据必须标记 source=mock；缺数、延迟、失败不伪装为当前实况。
- API 已提供服务器会话、租户/场景/角色校验、业务修订保存和审计；生产验收、真实采集、许可证、文件容量/扫描/跨实例能力尚未完成，不可泛化声称生产完成。
- 业务写入必须使用服务端会话决定租户，校验场景、角色、来源、owner 与 revision；禁止信任客户端传入的租户授权。
- 写功能前补有意义的测试；提交前 npm run check 与 npm run test:e2e。
- 后续场景/插件应验证销毁、快速切换、取消请求和不兼容版本。

- 用户最新约束：Figma 只参考「新电子沙盘」（1393:37400），其余 Page 不参考。按左侧菜单顺序实施。

- 新模型/视频/PDF 存于服务器受控文件卷；按租户和场景授权。禁止公开静态资源目录。变更文件引用和删除须共用单实例场景锁；数据库与文件卷必须成套备份。
