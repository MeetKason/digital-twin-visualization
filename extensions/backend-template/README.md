# 独立后端扩展模板

无需安装额外运行依赖，Node.js 22直接运行 `node server.mjs`；Docker构建需预先准备与平台相同的Node基础镜像。客户仅替换 `read` 适配逻辑，保持合同化观测JSON。默认模板从宿主地面小时产品读取数据，保留原始source；接入真实接口时禁止将失败补成Mock。

环境变量：`EXTENSION_ACCESS_TOKEN`（至少32字符）、`EXTENSION_TENANT_ID`（固定租户）、`CORE_API_URL`（内部宿主地址）、`CORE_API_USERNAME`与`CORE_API_PASSWORD`（该租户只读服务账号）、可选`PORT`/`HOST`。凭据由部署环境注入，不放前端、项目源码或日志。使用内部Docker网络，不向公网暴露3100端口。

接口：`GET /health`供进程探针；`GET /observations?sceneId=xian&time=2026-11-07T12%3A00%3A00%2B08%3A00`需要`Authorization: Bearer ...`及`X-DTV-Tenant`与固定租户一致。服务账号的产品、地区授权由宿主再次检查；调用方不能用请求参数切换租户。

宿主设置`DTV_EXTENSION_SERVICES_FILE`指向服务器JSON数组：

```json
[{"tenantId":"customer-a","datasetKey":"customer-observations","url":"http://customer-extension:3100/observations","tokenEnv":"CUSTOMER_EXTENSION_TOKEN","source":"mock","unit":"°C"}]
```

宿主的`CUSTOMER_EXTENSION_TOKEN`与扩展的`EXTENSION_ACCESS_TOKEN`一致。为该租户签发完整扩展版许可证，modules含plugins、datasets增加`customer-observations`。前端插件Provider声明相同datasetKey并调用`ctx.data.read("customer-observations",query.time,query.signal)`；浏览器只传逻辑ID，宿主完成鉴权、租户映射、超时、大小和观测合同校验，不接收插件指定的URL或令牌。

宿主与扩展需同步配置source和unit。模板返回的数据必须匹配请求时次和EPSG:4326，最多2000条，响应不超过1MB。失效账号自动重新登录一次；业务权限失败不会无限重试。`/health`仅代表进程存活，真实客户接口连通性需现场验收。模板不处理第三方协议和数据库迁移，这些由客户扩展工程独立维护。
