import "reflect-metadata";
import { IngestionController } from "./ingestion.controller";
import {
  hourlyTime,
  mockForecastMetadata,
  MOCK_LAYER_PRODUCTS,
  productGridFromObservations,
  layerForProduct,
} from "@dtv/contracts";
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
import { z } from "zod";
import type { ServerResponse } from "node:http";
import { renderIngestionMetrics } from "../../../packages/ingestion/src/metrics";
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
  /** 检查存储是否可用，并返回部署模式供运维探针判断服务状态。 */
  @Get("health") async health() {
    await this.p.ready();
    return {
      status: "ok",
      mode: "development",
      version: "0.3.0",
      commit: /^[0-9a-f]{40}$/.test(process.env.DTV_COMMIT ?? "")
        ? process.env.DTV_COMMIT
        : null,
      authentication: "server-session",
      storage:
        process.env.DATABASE_URL || process.env.PGHOST
          ? "postgresql"
          : "development-file",
    };
  }
  /** 将浏览器端天地图 Key 交给已登录的地图页面，供浏览器直连瓦片服务。 */
  @Get("display-config") async displayConfig(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    await this.p.current(req);
    res.setHeader("Cache-Control", "no-store");
    return {
      tiandituKey: process.env.TDT_API_KEY || null,
      cesiumIonAccessToken: process.env.CESIUM_ION_ACCESS_TOKEN || null,
    };
  }
  /** 导出低基数 Prometheus 指标；此端点不要求登录，应限制在监控网内。 */
  @Get("metrics") async metrics(
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return renderIngestionMetrics(await this.p.ingestion.metricsSnapshot());
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
  /** 仅在演示开关打开时建立隔离演示租户，不复用任何真实账号身份。 */
  @Post("auth/demo") async demo(
    @Req() req: Request,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    writeBoundary(req);
    const current = await this.p.auth.resolve(sessionToken(req));
    if (current) return { user: current };
    const { token, user } = await this.p.auth.demo();
    try {
      for (const scene of user.scenes)
        await this.p.initializeDemoScene(user, scene);
    } catch (error) {
      await this.p.auth.logout(token);
      throw error;
    }
    this.cookie(res, token);
    return { user };
  }
  /** 校验凭据并写入 HttpOnly 会话 Cookie，响应体不返回会话令牌。 */
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
    return this.p.scenesFor(user);
  }
  @Get("scenes/:id/scenario-pack") async scenarioPack(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.p.scenarios.read(await this.p.current(req), id);
  }
  @Put("scenes/:id/scenario-pack") async saveScenarioPack(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const parsed = z
      .object({ revision: z.number().int().nonnegative(), pack: z.unknown() })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("场景包提交格式错误");
    return this.p.scenarios.saveDraft(
      await this.p.current(req),
      id,
      parsed.data.revision,
      parsed.data.pack,
    );
  }
  @Post("scenes/:id/scenario-pack/publish") async publishScenarioPack(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const parsed = z
      .object({ revision: z.number().int().nonnegative() })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("发布修订号无效");
    return this.p.scenarios.publish(
      await this.p.current(req),
      id,
      parsed.data.revision,
    );
  }
  @Post("scenes/:id/scenario-pack/restore") async restoreScenarioPack(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        targetRevision: z.number().int().positive(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("恢复修订号无效");
    return this.p.scenarios.restore(
      await this.p.current(req),
      id,
      parsed.data.revision,
      parsed.data.targetRevision,
    );
  }
  @Get("scenes/:id/layers") async layers(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    const grant = await this.p.licensing.status(
      user.tenantId,
      user.kind === "demo",
    );
    return this.p.demo
      .layers(id, await this.p.scenarios.active(user.tenantId, id))
      .filter(
        (layer) =>
          layer.category !== "weather" ||
          (grant.datasets.includes(
            MOCK_LAYER_PRODUCTS[layer.id] ?? "surface-hourly",
          ) &&
            (!MOCK_LAYER_PRODUCTS[layer.id] ||
              grant.modules.includes("weather"))),
      );
  }
  @Get("scenes/:id/stations") async stations(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    return (await this.p.business(user, id)).data.stations;
  }
  @Get("scenes/:id/devices") async devices(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(user, id, "devices");
    return this.p.demo.devices(
      id,
      new Date(),
      await this.p.scenarios.active(user.tenantId, id),
    );
  }
  @Get("scenes/:id/business") async business(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    return this.p.business(user, id);
  }
  /** 保存业务修订前先校验场景和写权限；失败也写入拒绝审计。 */
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
  @Get("scenes/:id/publications") async publications(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    return this.p.businessPublications(user, id);
  }
  @Post("scenes/:id/publications/rollback") async rollbackPublication(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.p.access(req, id, true);
    const parsed = z
      .object({
        targetRevision: z.number().int().positive(),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("版本回滚请求格式错误");
    return this.p.rollbackBusiness(
      user,
      id,
      parsed.data.targetRevision,
      parsed.data.expectedRevision,
    );
  }
  /** 审批人与发布人必须分离，拒绝审批必须填写原因。 */
  @Post("scenes/:id/publications/:revision/review") async reviewPublication(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("revision") revisionValue: string,
    @Body() body: unknown,
  ) {
    const user = await this.p.access(req, id, true);
    const revision = Number(revisionValue);
    const parsed = z
      .object({
        decision: z.enum(["approve", "reject"]),
        message: z.string().max(200).default(""),
      })
      .strict()
      .safeParse(body);
    if (!Number.isSafeInteger(revision) || revision < 1 || !parsed.success)
      throw new BadRequestException("发布审批请求格式错误");
    if (parsed.data.decision === "reject" && !parsed.data.message.trim())
      throw new BadRequestException("拒绝发布时请填写原因");
    return this.p.reviewBusinessPublication(
      user,
      id,
      revision,
      parsed.data.decision,
      parsed.data.message.trim(),
    );
  }
  /** 仅已审批快照可激活；流量比例由仓库按稳定用户哈希执行。 */
  @Post("scenes/:id/publications/:revision/activate") async activatePublication(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("revision") revisionValue: string,
    @Body() body: unknown,
  ) {
    const user = await this.p.access(req, id, true);
    const revision = Number(revisionValue);
    const parsed = z
      .object({
        trafficPercent: z.number().int().min(1).max(100).default(100),
      })
      .strict()
      .safeParse(body ?? {});
    if (!Number.isSafeInteger(revision) || revision < 1 || !parsed.success)
      throw new BadRequestException("发布修订格式错误");
    return this.p.activateBusinessPublication(
      user,
      id,
      revision,
      parsed.data.trafficPercent,
    );
  }
  @Post("scenes/:id/publications") async publish(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const user = await this.p.access(req, id, true);
    const parsed = z
      .object({
        revision: z.number().int().positive(),
        message: z.string().max(200).default(""),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("发布请求格式错误");
    return this.p.publishBusiness(
      user,
      id,
      parsed.data.revision,
      parsed.data.message,
    );
  }
  @Get("scenes/:id/files") async listFiles(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(user, id, "files");
    const references = await this.p.fileReferenceStatus(user, id);
    return (await this.p.files.list(user.tenantId, id)).map((file) => ({
      ...file,
      referenced:
        references.draft.has(file.id) || references.publication.has(file.id),
      referencedInDraft: references.draft.has(file.id),
      referencedInPublication: references.publication.has(file.id),
    }));
  }
  /** 文件以流方式写入受控仓库，租户和地区范围来自当前服务端会话。 */
  @Post("scenes/:id/files") async uploadFile(
    @Req() req: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    try {
      const user = await this.p.access(req, id, true);
      await this.p.module(user, id, "files");
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
    await this.p.module(user, id, "files");
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
    await this.p.module(user, id, "files");
    return this.p.removeFile(user, id, fileId);
  }
  @Get("audit") async audit(@Req() req: Request) {
    const user = await this.p.current(req);
    await this.p.requireSettingsSection(user, "audit");
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可查看审计");
    return this.p.repo.audit(user.tenantId);
  }
  /** 授权状态始终可读取，无证账号仍能进入管理页修复授权。 */
  @Get("authorization") async authorization(@Req() req: Request) {
    const user = await this.p.current(req);
    return this.p.licensing.status(user.tenantId, user.kind === "demo");
  }
  @Get("admin/tenants") async tenants(@Req() req: Request) {
    return this.p.tenantDirectory(await this.p.current(req));
  }
  @Get("admin/tenants/:tenant/authorization") async tenantAuthorization(
    @Req() req: Request,
    @Param("tenant") tenant: string,
  ) {
    this.p.requirePlatformAdmin(await this.p.current(req));
    return this.p.licensing.status(tenant);
  }
  @Put("admin/tenants/:tenant/authorization") async importLicense(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const user = await this.p.current(req);
    await this.p.authorizeLicenseAdmin(user);
    const parsed = z
      .object({
        revision: z.number().int().nonnegative(),
        certificate: z.unknown(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("授权请求格式无效");
    return this.p.licensing.import(
      tenant,
      parsed.data.revision,
      parsed.data.certificate,
      user.id,
    );
  }
  @Post("admin/tenants/:tenant/authorization/revoke") async revokeLicense(
    @Req() req: Request,
    @Param("tenant") tenant: string,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const user = await this.p.current(req);
    await this.p.authorizeLicenseAdmin(user);
    const parsed = z
      .object({ revision: z.number().int().nonnegative() })
      .strict()
      .safeParse(body);
    if (!parsed.success) throw new BadRequestException("授权请求格式无效");
    return this.p.licensing.revoke(tenant, parsed.data.revision, user.id);
  }
  @Get("scenes/:id/plugins/data") async pluginData(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("productId") product: string,
    @Query("time") time: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(user, id, "plugins");
    if (this.p.extensions.has(user.tenantId, product)) {
      await this.p.module(user, id, "plugins", product);
      const controller = new AbortController(),
        close = () => controller.abort();
      res.once("close", close);
      try {
        return await this.p.extensions.observations(
          user.tenantId,
          id,
          product,
          time,
          controller.signal,
        );
      } finally {
        res.off("close", close);
      }
    }
    const layer = layerForProduct(product);
    if (!layer) throw new BadRequestException("插件数据集无效");
    const frame = await this.data(req, layer, id, time);
    // Provider只交换站点观测帧，不将核心栅格元信息泄露给不匹配的渲染器。
    return {
      source: frame.source,
      observedAt: frame.observedAt,
      unit: frame.unit,
      crs: frame.crs,
      observations: frame.observations,
    };
  }
  @Get("scenes/:id/plugins/authorization") async pluginAuthorization(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.p.access(req, id);
    await this.p.module(user, id, "plugins");
    return { allowed: true };
  }
  @Get("admin/accounts") async accounts(@Req() req: Request) {
    const user = await this.p.current(req);
    await this.p.requireSettingsSection(user, "accounts");
    return this.p.listAccounts(user);
  }
  @Post("admin/accounts") async createAccount(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const user = await this.p.current(req);
    await this.p.requireSettingsSection(user, "accounts");
    return this.p.createAccount(user, body);
  }
  @Put("admin/accounts/:id") async updateAccount(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const user = await this.p.current(req);
    await this.p.requireSettingsSection(user, "accounts");
    return this.p.updateAccount(user, id, body);
  }
  @Put("admin/accounts/:id/password") async resetAccountPassword(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    writeBoundary(req);
    const user = await this.p.current(req);
    await this.p.requireSettingsSection(user, "accounts");
    return this.p.resetAccountPassword(user, id, body);
  }
  @Get("layers/:id/times") async times(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("sceneId") sceneId: string,
  ) {
    const user = await this.p.access(req, sceneId);
    await this.p.layer(user, sceneId, id);
    const productId = MOCK_LAYER_PRODUCTS[id] ?? "surface-hourly";
    return (
      await this.p.ingestion.productStatus(user.tenantId, sceneId, productId)
    ).mode === "ingested"
      ? this.p.ingestion.times(user.tenantId, sceneId, productId)
      : this.p.demo.times(id);
  }
  /** 根据图层来源选择演示或入库数据；入库模式缺数时明确返回无数据。 */
  @Get("layers/:id/data") async data(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("sceneId") sceneId: string,
    @Query("time") time: string,
  ) {
    const user = await this.p.access(req, sceneId);
    const layer = await this.p.layer(user, sceneId, id);
    const productId = MOCK_LAYER_PRODUCTS[id] ?? "surface-hourly";
    const ingestionStatus = await this.p.ingestion.productStatus(
      user.tenantId,
      sceneId,
      productId,
    );
    if (ingestionStatus.mode === "demo")
      return this.p.demo.data(
        id,
        sceneId,
        time,
        await this.p.scenarios.active(user.tenantId, sceneId),
      );
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
      productId,
    );
    if (!observations.length && layer.category === "weather")
      throw new NotFoundException("对应时次无入库资料");
    return {
      source: ingestionStatus.source,
      storage: "ingested",
      observedAt: parsed.data,
      ...(id === "forecast" && ingestionStatus.source === "mock"
        ? { forecast: mockForecastMetadata(parsed.data) }
        : {}),
      unit: layer.unit,
      crs: "EPSG:4326",
      observations,
      ...(MOCK_LAYER_PRODUCTS[id]
        ? { gridCells: productGridFromObservations(observations, productId) }
        : {}),
    };
  }
  @Get("search") async search(
    @Req() req: Request,
    @Query("sceneId") sceneId: string,
    @Query("q") q = "",
  ) {
    const user = await this.p.access(req, sceneId);
    const result = this.p.demo.search(
      sceneId,
      q,
      await this.p.scenarios.active(user.tenantId, sceneId),
    );
    return {
      ...result,
      layers: await Promise.all(
        result.layers.map(async (layer) => {
          try {
            await this.p.layer(user, sceneId, layer.id);
            return layer;
          } catch {
            return null;
          }
        }),
      ).then((items) => items.filter((item) => item !== null)),
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
