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
import { hourlyTime, ingestionRequest } from "@dtv/contracts";
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
  @Get("products") async products(@Req() req: Request, @Param("id") id: string) {
    await this.p.access(req, id);
    return this.p.ingestion.productCatalog();
  }
  @Get() async status(@Req() req: Request, @Param("id") id: string, @Query("productId") productId?: string) {
    const user = await this.p.access(req, id);
    return {
      ...(await this.p.ingestion.productStatus(user.tenantId, id, productId ?? "surface-hourly")),
      executor:
        this.p.repo.constructor.name === "PostgresRepository"
          ? "worker"
          : "development-embedded",
    };
  }
  /** 汇总单产品任务与时次情况，供页面识别缺测、积压和过期计划。 */
  @Get("health") async health(@Req() req: Request, @Param("id") id: string, @Query("productId") productId = "surface-hourly") {
    const user = await this.p.access(req, id);
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
    const parsed = hourlyTime.safeParse(time);
    if (!parsed.success) throw new BadRequestException("时次格式错误");
    const status = await this.p.ingestion.status(user.tenantId, id);
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
    // 来源由服务端地区配置选择，忽略并覆盖客户端请求中的 source。
    const payload = z.object({
      source: z.enum(["mock", "tianqing"]).optional(),
      productId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).optional(),
      startTime: hourlyTime,
      endTime: hourlyTime,
    }).strict().safeParse(body);
    if (!payload.success) throw new BadRequestException("采集时次范围格式无效");
    const request = ingestionRequest.safeParse({
      ...payload.data,
      source: this.p.sourceForScene(id, payload.data.productId ?? "surface-hourly"),
      productId: payload.data.productId ?? "surface-hourly",
    });
    if (!request.success) throw new BadRequestException("采集时次范围无效");
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
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可切换数据模式和定时计划");
    const config = z
      .object({
        mode: z.enum(["demo", "ingested"]).optional(),
        enabled: z.boolean().optional(),
        productId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).optional(),
      })
      .strict()
      .refine((v) => v.mode !== undefined || v.enabled !== undefined)
      .safeParse(body);
    if (!config.success) throw new BadRequestException("配置格式无效");
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
