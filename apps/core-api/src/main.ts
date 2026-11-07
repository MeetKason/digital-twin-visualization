import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app";
if (process.env.DEPLOYMENT_MODE === "production")
  throw new Error(
    "当前为演示工程，生产认证与租户隔离未验收，不能以 production 模式启动",
  );
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
);
