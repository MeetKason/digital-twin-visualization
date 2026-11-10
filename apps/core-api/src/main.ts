import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AppModule } from "./app";
// 当前只允许演示/Mock 部署；真实数据、安全策略和现场验收完成前拒绝生产模式启动。
if (process.env.DEPLOYMENT_MODE === "production")
  throw new Error(
    "正式数据、许可证、容量与安全策略及现场部署验收尚未完成，暂不允许 production 模式启动",
  );
const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.useBodyParser("json", { limit: "2mb" });
app.set("trust proxy", process.env.TRUST_PROXY_HOPS === "1" ? 1 : false);
app.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.enableShutdownHooks();
await app.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
);
