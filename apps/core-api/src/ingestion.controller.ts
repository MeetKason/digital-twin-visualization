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
import { hourlyTime } from "@dtv/contracts";
import type { IngestionRequest } from "@dtv/contracts";
async function boundary<T>(work: () => Promise<T>) {
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
  @Get() async status(@Req() req: Request, @Param("id") id: string) {
    const user = await this.p.access(req, id);
    return {
      ...(await this.p.ingestion.status(user.tenantId, id)),
      executor:
        this.p.repo.constructor.name === "PostgresRepository"
          ? "worker"
          : "development-embedded",
    };
  }
  @Get("observations") async observations(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("time") time: string,
  ) {
    const user = await this.p.access(req, id);
    const parsed = hourlyTime.safeParse(time);
    if (!parsed.success) throw new BadRequestException("时次格式错误");
    const observations = await this.p.ingestion.observations(
      user.tenantId,
      id,
      parsed.data,
    );
    return {
      source: "mock",
      storage: "ingested",
      observedAt: parsed.data,
      unit: "°C",
      crs: "EPSG:4326",
      observations,
    };
  }
  @Post("jobs") async enqueue(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: IngestionRequest,
  ) {
    const user = await this.p.access(req, id, true);
    const job = await boundary(() =>
      this.p.ingestion.enqueue(user.tenantId, id, body, user.id),
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
