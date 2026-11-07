# Digital Twin Visualization

- 核心前端 React/TypeScript + Cesium，服务端 NestJS；保持 TypeScript strict。
- Cesium Viewer 仅允许出现在 apps/web/src/MapView.tsx；插件只调用 @dtv/sdk。
- 公共契约在 packages/contracts；地区差异写 scenarios JSON，不复制页面。
- 默认离线资源；禁止 Cesium ion、CDN、前端生产凭据、硬编码客户接口。
- mock 数据必须标记 source=mock；缺数、延迟、失败不伪装为当前实况。
- 当前 API 为只读演示服务，不可声称已实现生产认证、租户隔离或真实采集。
- 写功能前补有意义的测试；提交前 npm run check 与 npm run test:e2e。
- 后续场景/插件应验证销毁、快速切换、取消请求和不兼容版本。
