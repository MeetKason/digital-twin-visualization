import "reflect-metadata";
import { IngestionController } from "./ingestion.controller";
import { hourlyTime } from "@dtv/contracts";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Module,
  Param,
  Query,
  Req,
  Res,
  ForbiddenException,
} from "@nestjs/common";
import { pipeline } from "node:stream/promises";
import type { ServerResponse } from "node:http";
import {
  platform,
  sessionToken,
  writeBoundary,
  type Request,
} from "./platform/platform";
@Controller("api")
class ApiController {
  private p = platform();
  private cookie(res: ServerResponse, token: string) {
    res.setHeader(
      "Set-Cookie",
      `dtv_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 28800 : 0}${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
    res.setHeader("Cache-Control", "no-store");
  }
  @Get("health") async health() {
    await this.p.ready();
    return {
      status: "ok",
      mode: "development",
      version: "0.3.0",
      authentication: "server-session",
      storage:
        process.env.DATABASE_URL || process.env.PGHOST
          ? "postgresql"
          : "development-file",
    };
  }
  @Get("auth/session") async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return {
      user: await this.p.auth.resolve(sessionToken(req)),
      demoEnabled:
        process.env.DEMO_ENABLED !== "false" &&
        process.env.DEPLOYMENT_MODE !== "production",
    };
  }
  @Post("auth/demo") async demo(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    writeBoundary(req);
    const current = await this.p.auth.resolve(sessionToken(req));
    if (current) return { user: current };
    const { token, user } = await this.p.auth.demo();
    this.cookie(res, token);
    return { user };
  }
  @Post("auth/login") async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
    @Body() body: { username: string; password: string },
  ) {
    writeBoundary(req);
    const { token, user } = await this.p.auth.login(
      body?.username,
      body?.password,
      req.ip ?? req.socket.remoteAddress ?? "unknown",
    );
    await this.p.auth.logout(sessionToken(req));
    this.cookie(res, token);
    return { user };
  }
  @Post("auth/logout") async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    writeBoundary(req);
    await this.p.auth.logout(sessionToken(req));
    this.cookie(res, "");
    return { ok: true };
  }
  @Get("scenes") async scenes(@Req() req: Request) {
    const user = await this.p.current(req);
    return this.p.demo.scenes().filter((s) => user.scenes.includes(s.id));
  }
  @Get("scenes/:id/layers") async layers(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    await this.p.access(req, id);
    return this.p.demo.layers(id);
  }
  @Get("scenes/:id/stations") async stations(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    return (await this.p.business(user, id)).data.stations;
  }
  @Get("scenes/:id/business") async business(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    return this.p.business(user, id);
  }
  @Put("scenes/:id/business") async save(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.p.access(req, id, true);
    try {
      return await this.p.save(user, id, body);
    } catch (error) {
      await this.p.repo
        .logAudit({
          tenantId: user.tenantId,
          actor: user.id,
          sceneId: id,
          action: "business.write",
          result: "rejected",
        })
        .catch(() => {});
      throw error;
    }
  }
  @Get("scenes/:id/files") async listFiles(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    const assets = (await this.p.business(user, id)).data.assets;
    return (await this.p.files.list(user.tenantId, id)).map((file) => ({
      ...file,
      referenced: assets.some((a) => a.blobId === file.id),
    }));
  }
  @Post("scenes/:id/files") async uploadFile(
    @Req() req: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    try {
      const user = await this.p.access(req, id, true);
      const file = await this.p.files.upload(user.tenantId, id, req);
      await this.p.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: id,
        action: "file.upload",
        result: "success",
      });
      return file;
    } catch (error) {
      // Never reuse a connection with an unread or rejected upload body.
      res.setHeader("Connection", "close");
      req.resume();
      throw error;
    }
  }
  @Get("scenes/:id/files/:fileId") async downloadFile(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Res() res: ServerResponse,
  ) {
    const user = await this.p.access(req, id);
    const { meta, stream } = await this.p.files.download(
      user.tenantId,
      id,
      fileId,
    );
    res.setHeader("Content-Type", meta.type);
    res.setHeader("Content-Length", meta.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    await pipeline(stream, res).catch(() => {
      res.destroy();
    });
  }
  @Delete("scenes/:id/files/:fileId") async deleteFile(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
  ) {
    const user = await this.p.access(req, id, true);
    return this.p.removeFile(user, id, fileId);
  }
  @Get("audit") async audit(@Req() req: Request) {
    const user = await this.p.current(req);
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可查看审计");
    return this.p.repo.audit(user.tenantId);
  }
  @Get("layers/:id/times") async times(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("sceneId") sceneId: string,
  ) {
    const user = await this.p.access(req, sceneId);
    this.p.demo.layer(id);
    return (await this.p.ingestion.status(user.tenantId, sceneId)).mode ===
      "ingested"
      ? this.p.ingestion.times(user.tenantId, sceneId)
      : this.p.demo.times(id);
  }
  @Get("layers/:id/data") async data(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("sceneId") sceneId: string,
    @Query("time") time: string,
  ) {
    const user = await this.p.access(req, sceneId);
    const layer = this.p.demo.layer(id);
    if ((await this.p.ingestion.status(user.tenantId, sceneId)).mode === "demo")
      return this.p.demo.data(id, sceneId, time);
    if (!layer.available) throw new NotFoundException(layer.reason);
    if (!time && layer.category !== "weather")
      return {
        source: "mock",
        storage: "ingested",
        observedAt: "",
        unit: layer.unit,
        crs: "EPSG:4326",
        observations: [],
      };
    if (!time) throw new NotFoundException("暂无入库时次，请先采集");
    const parsed = hourlyTime.safeParse(time);
    if (!parsed.success) throw new BadRequestException("时次格式错误");
    const observations = await this.p.ingestion.observations(
      user.tenantId,
      sceneId,
      parsed.data,
    );
    if (!observations.length && layer.category === "weather")
      throw new NotFoundException("对应时次无入库资料");
    return {
      source: "mock",
      storage: "ingested",
      observedAt: parsed.data,
      unit: layer.unit,
      crs: "EPSG:4326",
      observations,
    };
  }
  @Get("search") async search(
    @Req() req: Request,
    @Query("sceneId") sceneId: string,
    @Query("q") q = "",
  ) {
    const user = await this.p.access(req, sceneId);
    const result = this.p.demo.search(sceneId, q);
    return {
      ...result,
      stations: result.coordinate
        ? []
        : (await this.p.business(user, sceneId)).data.stations.filter(
            (s) => s.name.includes(q.trim()) || s.id.includes(q.trim()),
          ),
    };
  }
}
@Module({
  controllers: [ApiController, IngestionController],
  providers: [
    {
      provide: "PLATFORM_SHUTDOWN",
      useFactory: () => ({
        onApplicationBootstrap: () => platform().start(),
        onApplicationShutdown: () => platform().close(),
      }),
    },
  ],
})
export class AppModule {}
