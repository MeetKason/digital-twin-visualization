import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Param,
  Req,
  BadRequestException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import { z } from "zod";
import { platform, type Request } from "./platform/platform";
import { IngestionError } from "../../../packages/ingestion/src/state";
import { hourlyTime, ingestionRequest, layerForProduct } from "@dtv/contracts";
import { analyzeIngestionHealth } from "../../../packages/ingestion/src/health";
async function boundary<T>(work: () => Promise<T>) {
  // 将队列领域错误转换为 HTTP 状态码，保留统一的 API 错误格式。
  try {
    return await work();
  } catch (e) {
    if (e instanceof IngestionError)
      throw new HttpException(e.message, e.status);
    throw e;
  }
}
@Controller("api/scenes/:id/ingestion")
export class IngestionController {
  private p = platform();
  @Get("products") async products(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(user, id, "ingestion");
    const grant = await this.p.licensing.status(
      user.tenantId,
      user.kind === "demo",
    );
    const scene = await this.p.scenarios.active(user.tenantId, id);
    return this.p.ingestion
      .productCatalog()
      .filter((product) => grant.datasets.includes(product.id))
      .map((product) => {
        const layer = layerForProduct(product.id);
        return scene.enabledLayers &&
          layer &&
          !scene.enabledLayers.includes(layer)
          ? { ...product, available: false, disabledReason: "场景未启用" }
          : product;
      });
  }
  @Get() async status(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("productId") productId?: string,
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(
      user,
      id,
      productId && productId !== "surface-hourly" ? "weather" : "map",
      productId ?? "surface-hourly",
    );
    const grant = await this.p.licensing.status(
      user.tenantId,
      user.kind === "demo",
    );
    const status = await this.p.ingestion.productStatus(
      user.tenantId,
      id,
      productId ?? "surface-hourly",
    );
    return {
      ...(!grant.modules.includes("ingestion")
        ? { ...status, jobs: [] }
        : status),
      executor:
        this.p.repo.constructor.name === "PostgresRepository"
          ? "worker"
          : "development-embedded",
    };
  }
  /** 汇总单产品任务与时次情况，供页面识别缺测、积压和过期计划。 */
  @Get("health") async health(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("productId") productId = "surface-hourly",
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(user, id, "ingestion", productId);
    const [status, times] = await Promise.all([
      this.p.ingestion.productStatus(user.tenantId, id, productId),
      this.p.ingestion.times(user.tenantId, id, productId),
    ]);
    return analyzeIngestionHealth(status, times);
  }
  @Get("observations") async observations(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("time") time: string,
    @Query("productId") productId = "surface-hourly",
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(user, id, "ingestion", productId);
    await this.p.product(user, id, productId);
    const parsed = hourlyTime.safeParse(time);
    if (!parsed.success) throw new BadRequestException("时次格式错误");
    const status = await this.p.ingestion.productStatus(
      user.tenantId,
      id,
      productId,
    );
    const observations = await this.p.ingestion.observations(
      user.tenantId,
      id,
      parsed.data,
      productId,
    );
    return {
      source: status.source,
      productId,
      storage: "ingested",
      observedAt: parsed.data,
      unit: "°C",
      crs: "EPSG:4326",
      observations,
    };
  }
  /** 创建任务时忽略客户端 source，由地区和产品的服务端配置决定数据源。 */
  @Post("jobs") async enqueue(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.p.access(req, id, true);
    await this.p.requireSettingsSection(user, "stations", id);
    // 来源由服务端地区配置选择，忽略并覆盖客户端请求中的 source。
    const payload = z
      .object({
        source: z.enum(["mock", "tianqing"]).optional(),
        productId: z
          .string()
          .regex(/^[a-z][a-z0-9-]{1,63}$/)
          .optional(),
        startTime: hourlyTime,
        endTime: hourlyTime,
      })
      .strict()
      .safeParse(body);
    if (!payload.success) throw new BadRequestException("采集时次范围格式无效");
    const request = ingestionRequest.safeParse({
      ...payload.data,
      source: this.p.sourceForScene(
        id,
        payload.data.productId ?? "surface-hourly",
      ),
      productId: payload.data.productId ?? "surface-hourly",
    });
    if (!request.success) throw new BadRequestException("采集时次范围无效");
    await this.p.module(user, id, "ingestion", request.data.productId);
    await this.p.product(user, id, request.data.productId);
    const job = await boundary(() =>
      this.p.ingestion.enqueue(user.tenantId, id, request.data, user.id),
    );
    await this.p.repo.logAudit({
      tenantId: user.tenantId,
      actor: user.id,
      sceneId: id,
      action: "ingestion.enqueue",
      result: "success",
    });
    return job;
  }
  @Put("config") async configure(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.p.access(req, id, true);
    await this.p.requireSettingsSection(user, "stations", id);
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可切换数据模式和定时计划");
    await this.p.module(user, id, "ingestion");
    const config = z
      .object({
        mode: z.enum(["demo", "ingested"]).optional(),
        enabled: z.boolean().optional(),
        productId: z
          .string()
          .regex(/^[a-z][a-z0-9-]{1,63}$/)
          .optional(),
      })
      .strict()
      .refine((v) => v.mode !== undefined || v.enabled !== undefined)
      .safeParse(body);
    if (!config.success) throw new BadRequestException("配置格式无效");
    if (config.data.enabled !== false)
      await this.p.module(
        user,
        id,
        "ingestion",
        config.data.productId ?? "surface-hourly",
      );
    if (config.data.enabled === true)
      await this.p.product(user, id, config.data.productId ?? "surface-hourly");
    const state = await this.p.ingestion.configure(
      user.tenantId,
      id,
      config.data,
    );
    await this.p.repo.logAudit({
      tenantId: user.tenantId,
      actor: user.id,
      sceneId: id,
      action: "ingestion.configure",
      result: "success",
    });
    return state;
  }
  @Post("jobs/:jobId/retry") async retry(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("jobId") jobId: string,
  ) {
    return this.change(req, id, jobId, "retry");
  }
  @Post("jobs/:jobId/cancel") async cancel(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("jobId") jobId: string,
  ) {
    return this.change(req, id, jobId, "cancel");
  }
  private async change(
    req: Request,
    id: string,
    jobId: string,
    action: "retry" | "cancel",
  ) {
    const user = await this.p.access(req, id, true);
    await this.p.requireSettingsSection(user, "stations", id);
    await this.p.module(user, id, "ingestion");
    if (action === "retry") {
      const state = await this.p.ingestion.status(user.tenantId, id);
      const task = state.jobs.find((item) => item.id === jobId);
      if (task) {
        await this.p.module(user, id, "ingestion", task.productId);
        await this.p.product(user, id, task.productId);
      }
    }
    const job = await boundary(() =>
      this.p.ingestion[action](user.tenantId, id, jobId),
    );
    await this.p.repo.logAudit({
      tenantId: user.tenantId,
      actor: user.id,
      sceneId: id,
      action: `ingestion.${action}`,
      result: "success",
    });
    return job;
  }
}
