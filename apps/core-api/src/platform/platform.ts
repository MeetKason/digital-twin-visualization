import { ExtensionServices } from "./extensionServices";
import { TenantLicensing, loadLicenseRoots } from "./licensing";
import { ScenarioCatalog } from "./scenarios";
import demoFixtures from "../demo-assets/fixtures.generated.json";
import { createDemoBusiness } from "./demoBusiness";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
  ConflictException,
} from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import {
  FileRepository,
  PostgresRepository,
  type Repository,
  type Principal,
} from "./repository";
import { AuthService, hashPassword, type Account } from "./auth";
import { FileStore } from "./files";
import { FileIngestionStore } from "../../../../packages/ingestion/src/file";
import { PostgresIngestionStore } from "../../../../packages/ingestion/src/postgres";
import {
  ConfiguredSceneConnector,
  QueueWorker,
} from "../../../../packages/ingestion/src/worker";
import { loadTianqingConfig } from "../../../../packages/ingestion/src/tianqing";
import type { IngestionStore } from "../../../../packages/ingestion/src/state";
import { DemoService } from "../service";
import {
  demoStations,
  parseBusinessData,
  layerForProduct,
  MOCK_LAYER_PRODUCTS,
  moduleForMenu,
  MenuIds,
  SettingsSectionIds,
  effectiveSettingsSections,
  type SettingsSectionId,
  type ProductModule,
  type SceneConfig,
  type BusinessData,
} from "@dtv/contracts";
const accountSchema = z.array(
  z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    role: z.enum(["admin", "editor", "viewer"]),
    scenes: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
      .min(1)
      .max(50),
    passwordHash: z.string().regex(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/),
    disabled: z.boolean().optional(),
    settingsSections: z.array(z.enum(SettingsSectionIds)).max(SettingsSectionIds.length).optional(),
  }),
);
export type Request = IncomingMessage & { ip?: string };
/** 依用户稳定哈希分桶；同一只读用户在发布期间始终落入同一灰度组。 */
export function isPublicationCohort(userId: string, trafficPercent: number) {
  if (trafficPercent >= 100) return true;
  if (trafficPercent <= 0) return false;
  const bucket =
    Number.parseInt(
      createHash("sha256").update(userId).digest("hex").slice(0, 8),
      16,
    ) % 100;
  return bucket < trafficPercent;
}
export function sessionToken(req: Request) {
  const raw = req.headers.cookie ?? "";
  return (
    raw
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("dtv_session="))
      ?.slice(12) ?? ""
  );
}
export function writeBoundary(req: Request) {
  if (req.headers["x-dtv-request"] !== "1")
    throw new ForbiddenException("写入请求缺少来源校验");
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) throw new Error();
    } catch {
      throw new ForbiddenException("不允许跨站写入");
    }
  }
}
export class Platform {
  private closed = false;
  private locks = new Map<string, Promise<unknown>>();
  readonly files: FileStore;
  readonly extensions = new ExtensionServices();
  readonly ingestion: IngestionStore;
  readonly scenarios: ScenarioCatalog;
  readonly licensing: TenantLicensing;
  private platformAdminIds: string[];
  private demoEnabled: boolean;
  readonly tianqing = loadTianqingConfig();
  private timer?: ReturnType<typeof setInterval>;
  private executing: Promise<unknown> | null = null;
  start() {
    if (this.timer || this.repo instanceof PostgresRepository) return;
    const worker = new QueueWorker(
      this.ingestion,
      new ConfiguredSceneConnector(
        this.tianqing,
        (id, tenant) => this.scenarios.active(tenant, id),
        async (tenant, id, product) => {
          await this.licensing.requireTask(
            tenant,
            id,
            product,
            this.demoEnabled,
          );
        },
      ),
    );
    this.timer = setInterval(() => {
      if (!this.executing)
        this.executing = worker
          .tick()
          .catch(() => {
            console.error("开发采集执行器失败，请检查存储");
          })
          .finally(() => {
            this.executing = null;
          });
    }, 200);
    this.timer.unref();
  }
  private async locked<T>(
    user: Principal,
    scene: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([user.tenantId, scene]);
    const task = (this.locks.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(work);
    this.locks.set(key, task);
    try {
      return await task;
    } finally {
      if (this.locks.get(key) === task) this.locks.delete(key);
    }
  }
  /** 文件保护同时覆盖工作草稿和全部不可变发布快照，供清单与删除共用。 */
  async fileReferenceStatus(user: Principal, scene: string) {
    const [draft, history] = await Promise.all([
      this.repo.readBusiness(user.tenantId, scene),
      this.repo.publicationFileReferences(user.tenantId, scene),
    ]);
    const assets = draft ? parseBusinessData(draft.data, scene).assets : [];
    return {
      draft: new Set(assets.map((asset) => asset.blobId)),
      publication: new Set(history),
    };
  }
  async removeFile(user: Principal, scene: string, id: string) {
    return this.locked(user, scene, async () => {
      const references = await this.fileReferenceStatus(user, scene);
      if (references.draft.has(id))
        throw new ConflictException("文件仍被业务资料引用，请先移除引用并保存");
      if (references.publication.has(id))
        throw new ConflictException(
          "文件仍被发布历史引用，为保证在线版本和历史恢复可用，不能删除",
        );
      await this.files.remove(user.tenantId, scene, id);
      await this.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: scene,
        action: "file.delete",
        result: "success",
      });
      return { ok: true };
    });
  }
  async close() {
    clearInterval(this.timer);
    await this.executing;
    if (!this.closed && this.repo instanceof PostgresRepository) {
      this.closed = true;
      await this.repo.pool.end();
    }
  }
  async ready() {
    try {
      await this.repo.getSession("0".repeat(64));
      await this.repo.readBusiness("__health__", "__health__");
      await this.repo.audit("__health__");
      if (this.repo instanceof PostgresRepository)
        await this.repo.pool.query("SELECT 1 FROM ingestion_state LIMIT 0");
      if (this.repo instanceof PostgresRepository)
        await this.repo.pool.query(
          "SELECT 1 FROM platform_configuration LIMIT 0",
        );
    } catch {
      throw new ServiceUnavailableException("平台存储未就绪");
    }
  }
  readonly auth: AuthService;
  readonly demo = new DemoService();
  constructor(
    readonly repo: Repository,
    accounts: z.infer<typeof accountSchema>,
    allowDemo: boolean,
    fileRoot = resolve(process.env.DATA_DIR ?? ".data", "files"),
    private readonly accountsFile?: string,
  ) {
    this.demoEnabled = allowDemo;
    this.platformAdminIds = (process.env.PLATFORM_ADMIN_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    this.licensing = new TenantLicensing(
      repo,
      loadLicenseRoots(),
      process.env.LICENSE_REQUIRED === "true" ||
        (process.env.LICENSE_REQUIRED !== "false" &&
          process.env.DEPLOYMENT_MODE === "production"),
    );
    this.files = new FileStore(fileRoot);
    this.scenarios = new ScenarioCatalog(repo);
    // 雷达和卫星当前使用产品隔离的 Mock Connector；后续可替换为地区级真实连接器。
    const resolveSource = (scene: string, productId = "surface-hourly") =>
      productId === "surface-hourly"
        ? this.tianqing.sourceForScene(scene)
        : ("mock" as const);
    this.ingestion =
      repo instanceof PostgresRepository
        ? new PostgresIngestionStore(repo.pool, resolveSource)
        : new FileIngestionStore(resolve(fileRoot, ".."), resolveSource);
    this.auth = new AuthService(
      repo,
      accounts,
      allowDemo,
      this.platformAdminIds,
    );
    this.accounts = accounts;
  }
  private readonly accounts: Account[];
  /** 平台管理员身份由服务器配置和当前账号共同确定，绝不采信请求体声明。 */
  isPlatformAdmin(user: Principal) {
    return (
      user.kind === "account" &&
      user.role === "admin" &&
      this.platformAdminIds.includes(user.id) &&
      this.accounts.some(
        (a) => a.id === user.id && a.role === "admin" && !a.disabled,
      )
    );
  }
  requirePlatformAdmin(user: Principal) {
    if (!this.isPlatformAdmin(user))
      throw new ForbiddenException("仅平台管理员可管理租户产品授权");
  }
  /** 每次读取生效场景配置，确保场景包发布后授权立即收敛。 */
  async requireSettingsSection(user: Principal, section: SettingsSectionId, sceneId?: string) {
    if (this.isPlatformAdmin(user) || user.kind === "demo") return;
    const scenes = sceneId
      ? [await this.scenarios.active(user.tenantId, sceneId)]
      : await this.scenarios.list(user);
    if (!scenes.some((scene) => effectiveSettingsSections(
      scene.ui?.settingsSections, user.settingsSections, user.role, false,
    ).includes(section)))
      throw new ForbiddenException("未授权使用该系统管理功能");
  }
  async authorizeLicenseAdmin(user: Principal) {
    try {
      this.requirePlatformAdmin(user);
    } catch (error) {
      await this.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: "",
        action: "license.manage",
        result: "denied",
      });
      throw error;
    }
  }
  tenantDirectory(user: Principal) {
    this.requirePlatformAdmin(user);
    return [...new Set(this.accounts.map((a) => a.tenantId))].map(
      (tenantId) => ({
        tenantId,
        accountCount: this.accounts.filter(
          (a) => a.tenantId === tenantId && !a.disabled,
        ).length,
      }),
    );
  }
  async module(
    user: Principal,
    scene: string,
    module: ProductModule,
    dataset?: string,
  ) {
    try {
      return await this.licensing.require(
        user.tenantId,
        scene,
        module,
        dataset,
        user.kind === "demo",
      );
    } catch (error) {
      await this.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: scene,
        action: `license.${module}`,
        result: "denied",
      });
      throw error;
    }
  }
  async scenesFor(user: Principal): Promise<SceneConfig[]> {
    const status = await this.licensing.status(
      user.tenantId,
      user.kind === "demo",
    );
    if (!status.modules.includes("map")) return [];
    return (await this.scenarios.list(user))
      .filter((s) => !status.regions || status.regions.includes(s.id))
      .map((s) => ({
        ...s,
        ui: {
          menus: (s.ui?.menus ?? [...MenuIds]).filter(
            (menu) =>
              (menu !== "settings" || effectiveSettingsSections(
                s.ui?.settingsSections, user.settingsSections, user.role,
                this.isPlatformAdmin(user) || user.kind === "demo",
              ).length > 0) &&
              (!moduleForMenu[menu] || status.modules.includes(moduleForMenu[menu]!)),
          ),
          settingsSections: effectiveSettingsSections(
            s.ui?.settingsSections, user.settingsSections, user.role,
            this.isPlatformAdmin(user) || user.kind === "demo",
          ),
          theme: s.ui?.theme ?? { primary: "#1263c4", navy: "#1c466c" },
          layout: s.ui?.layout ?? { panelWidth: 264, timelineHeight: 112 },
        },
      }));
  }
  private async checkAccountGrant(
    user: Principal,
    fields: { tenantId: string; scenes: string[]; role: "admin" | "editor" | "viewer"; settingsSections?: SettingsSectionId[]; disabled?: boolean },
    editingId?: string,
  ) {
    if (fields.tenantId.startsWith("demo-"))
      throw new ForbiddenException("真实账号不能使用演示租户前缀");
    if (
      !this.isPlatformAdmin(user) &&
      (fields.tenantId !== user.tenantId ||
        fields.scenes.some((id) => !user.scenes.includes(id)))
    )
      throw new ForbiddenException("不能跨租户或超出自身地区分配账号");
    // 受限管理员不能通过创建或修改其他管理员来扩大自己的授权。
    if (!this.isPlatformAdmin(user) && user.settingsSections && fields.role === "admin" &&
      (fields.settingsSections ?? SettingsSectionIds).some((id) => !user.settingsSections!.includes(id)))
      throw new ForbiddenException("不能分配超出自身范围的系统管理权限");
    if (fields.disabled) return;
    const grant = await this.licensing.status(fields.tenantId);
    // 平台管理员可先开通租户管理员，用于许可证尚未导入的新租户；业务接口仍拒绝无证访问。
    if (this.isPlatformAdmin(user) && grant.state === "missing") return;
    if (
      !grant.modules.includes("map") ||
      (grant.regions &&
        fields.scenes.some((id) => !grant.regions!.includes(id)))
    )
      throw new ForbiddenException("账号地区超出产品授权");
    if (
      this.accounts.filter(
        (a) =>
          a.tenantId === fields.tenantId && !a.disabled && a.id !== editingId,
      ).length >= grant.maxAccounts
    )
      throw new ForbiddenException("已达到许可证账号上限");
  }
  /** 隐藏未授权的业务集合与关联，不把模块关闭解释成删除资料。 */
  private async visibleBusiness(
    user: Principal,
    data: BusinessData,
  ): Promise<BusinessData> {
    const grant = await this.licensing.status(
      user.tenantId,
      user.kind === "demo",
    );
    const files = grant.modules.includes("files"),
      roam = grant.modules.includes("roam");
    return {
      ...data,
      assets: files ? data.assets : [],
      bookmarks: roam ? data.bookmarks : [],
      plans: roam
        ? data.plans.map((plan) => ({
            ...plan,
            points: plan.points.map((point) =>
              files ? point : { ...point, modelId: undefined },
            ),
          }))
        : [],
      stations: data.stations.map((station) => ({
        ...station,
        ...(!files ? { modelId: undefined } : {}),
        ...(!roam ? { bookmarkId: undefined } : {}),
      })),
    };
  }
  async business(user: Principal, scene: string) {
    const current = await this.businessRaw(user, scene);
    return { ...current, data: await this.visibleBusiness(user, current.data) };
  }
  /** 来源路由由服务端地区配置决定；除地面小时天擎外均使用对应 Mock 产品。 */
  sourceForScene(sceneId: string, productId = "surface-hourly") {
    return productId === "surface-hourly"
      ? this.tianqing.sourceForScene(sceneId)
      : ("mock" as const);
  }
  private accountChangeQueue: Promise<void> = Promise.resolve();
  private async serializeAccountChange<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.accountChangeQueue;
    let release!: () => void;
    this.accountChangeQueue = new Promise<void>(
      (resolve) => (release = resolve),
    );
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
  private async persistAccounts(next: Account[]) {
    if (!this.accountsFile)
      throw new ServiceUnavailableException("未配置可写的 AUTH_USERS_FILE");
    const dir = resolve(this.accountsFile, "..");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = resolve(dir, `.accounts-${process.pid}-${Date.now()}.tmp`);
    try {
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await chmod(tmp, 0o600);
      await rename(tmp, this.accountsFile);
      this.accounts.splice(0, this.accounts.length, ...next);
    } finally {
      await import("node:fs/promises").then(({ unlink }) =>
        unlink(tmp).catch(() => {}),
      );
    }
  }
  private requireAccountAdmin(user: Principal) {
    if (user.kind !== "account" || user.role !== "admin" ||
      (!this.isPlatformAdmin(user) && user.settingsSections && !user.settingsSections.includes("accounts")))
      throw new ForbiddenException("仅真实管理员可管理登录账号");
  }
  listAccounts(user: Principal) {
    this.requireAccountAdmin(user);
    if (!this.accountsFile)
      throw new ServiceUnavailableException("未配置可写的 AUTH_USERS_FILE");
    return this.accounts
      .filter((a) => this.isPlatformAdmin(user) || a.tenantId === user.tenantId)
      .map(({ id, tenantId, role, scenes, disabled, settingsSections }) => ({
        id,
        tenantId,
        role,
        scenes,
        disabled,
        settingsSections,
      }));
  }
  /** 只有真实管理员能创建账号；校验角色、场景后持久化带盐密码摘要。 */
  async createAccount(user: Principal, input: unknown) {
    this.requireAccountAdmin(user);
    const parsed = z
      .object({
        id: z
          .string()
          .trim()
          .min(2)
          .max(64)
          .regex(/^[a-zA-Z0-9._-]+$/),
        tenantId: z.string().trim().min(1).max(64),
        role: z.enum(["admin", "editor", "viewer"]),
        scenes: z
          .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
          .min(1)
          .max(50),
        password: z.string().min(12).max(128),
        settingsSections: z.array(z.enum(SettingsSectionIds)).max(SettingsSectionIds.length).optional(),
      })
      .safeParse(input);
    if (!parsed.success)
      throw new BadRequestException("账号信息或初始密码不符合要求");
    return this.serializeAccountChange(async () => {
      if (this.accounts.some((a) => a.id === parsed.data.id))
        throw new ConflictException("账号 ID 已存在");
      if (
        !this.isPlatformAdmin(user) &&
        this.platformAdminIds.includes(parsed.data.id)
      )
        throw new ForbiddenException("该账号ID保留给平台管理员");
      await this.checkAccountGrant(user, parsed.data);
      const { password, ...fields } = parsed.data;
      const account: Account = {
        ...fields,
        passwordHash: hashPassword(password),
      };
      const next = [...this.accounts, account];
      await this.persistAccounts(next);
      await this.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: "",
        action: "account.create",
        result: "success",
      });
      return {
        id: account.id,
        tenantId: account.tenantId,
        role: account.role,
        scenes: account.scenes,
        disabled: account.disabled,
        settingsSections: account.settingsSections,
      };
    });
  }
  /** 更新账号时保留最后一个可用管理员，并使角色变化即时影响会话授权。 */
  async updateAccount(user: Principal, id: string, input: unknown) {
    this.requireAccountAdmin(user);
    const parsed = z
      .object({
        tenantId: z.string().trim().min(1).max(64),
        role: z.enum(["admin", "editor", "viewer"]),
        scenes: z
          .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
          .min(1)
          .max(50),
        disabled: z.boolean(),
        settingsSections: z.array(z.enum(SettingsSectionIds)).max(SettingsSectionIds.length).optional(),
      })
      .safeParse(input);
    if (!parsed.success) throw new BadRequestException("账号信息格式错误");
    return this.serializeAccountChange(async () => {
      const target = this.accounts.find((a) => a.id === id);
      if (
        !target ||
        (!this.isPlatformAdmin(user) &&
          (target.tenantId !== user.tenantId ||
            this.platformAdminIds.includes(id)))
      )
        throw new ForbiddenException("无权管理该账号");
      await this.checkAccountGrant(user, parsed.data, id);
      if (
        id === user.id &&
        (parsed.data.role !== "admin" || parsed.data.disabled)
      )
        throw new ForbiddenException("不能停用或降级当前管理员账号");
      const next = this.accounts.map((a) =>
        a.id === id ? { ...a, ...parsed.data } : a,
      );
      if (!next.some((a) => a.role === "admin" && !a.disabled))
        throw new ConflictException("至少保留一个启用的管理员账号");
      await this.persistAccounts(next);
      await this.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: "",
        action: "account.update",
        result: "success",
      });
      const updated = next.find((a) => a.id === id)!;
      return {
        id: updated.id,
        tenantId: updated.tenantId,
        role: updated.role,
        scenes: updated.scenes,
        disabled: updated.disabled,
        settingsSections: updated.settingsSections,
      };
    });
  }
  /** 重置密码后增加凭据版本，旧会话在下次解析时自动失效。 */
  async resetAccountPassword(user: Principal, id: string, input: unknown) {
    this.requireAccountAdmin(user);
    const parsed = z
      .object({ password: z.string().min(12).max(128) })
      .safeParse(input);
    if (!parsed.success) throw new BadRequestException("密码至少 12 位");
    return this.serializeAccountChange(async () => {
      const target = this.accounts.find((a) => a.id === id);
      if (
        !target ||
        (!this.isPlatformAdmin(user) &&
          (target.tenantId !== user.tenantId ||
            this.platformAdminIds.includes(id)))
      )
        throw new ForbiddenException("无权管理该账号");
      const next = this.accounts.map((a) =>
        a.id === id
          ? { ...a, passwordHash: hashPassword(parsed.data.password) }
          : a,
      );
      await this.persistAccounts(next);
      await this.repo.logAudit({
        tenantId: user.tenantId,
        actor: user.id,
        sceneId: "",
        action: "account.password.reset",
        result: "success",
      });
      return { ok: true };
    });
  }
  async current(req: Request): Promise<Principal> {
    const user = await this.auth.resolve(sessionToken(req));
    if (!user) throw new UnauthorizedException("请先登录");
    return user;
  }
  /** 把身份认证、场景授权和写请求来源校验收口到同一入口。 */
  async access(req: Request, scene: string, write = false) {
    if (write) writeBoundary(req);
    const user = await this.current(req);
    await this.module(user, scene, "map");
    await this.scenarios.active(user.tenantId, scene);
    await this.auth.authorize(user, scene, write);
    return user;
  }
  /** 前端隐藏图层之外，数据和时次API也按生效包执行图层白名单。 */
  async layer(user: Principal, sceneId: string, id: string) {
    const scene = await this.scenarios.active(user.tenantId, sceneId);
    const layer = this.demo.layer(id);
    if (layer.category === "weather")
      await this.module(
        user,
        sceneId,
        MOCK_LAYER_PRODUCTS[id] ? "weather" : "map",
        MOCK_LAYER_PRODUCTS[id] ?? "surface-hourly",
      );
    if (scene.enabledLayers && !scene.enabledLayers.includes(id))
      throw new ForbiddenException("该图层未在当前场景启用");
    return layer;
  }
  async product(user: Principal, sceneId: string, productId: string) {
    const layerId = layerForProduct(productId);
    if (layerId) await this.layer(user, sceneId, layerId);
  }
  /** 创建新的演示资料包；已有修订直接返回，禁止覆盖正式账号或现有工作。 */
  async initializeDemoScene(user: Principal, scene: string) {
    if (
      user.kind !== "demo" ||
      user.role !== "admin" ||
      !user.scenes.includes(scene)
    )
      throw new ForbiddenException("仅隔离演示会话可以初始化演示资料");
    return this.locked(user, scene, async () => {
      const existing = await this.repo.readBusiness(user.tenantId, scene);
      if (existing) return this.business(user, scene);
      const data = createDemoBusiness(
        await this.scenarios.active(user.tenantId, scene),
      );
      const created: string[] = [];
      try {
        for (const fixture of demoFixtures) {
          const meta = await this.files.storeDemoFile(
            user.tenantId,
            scene,
            new File([Buffer.from(fixture.base64, "base64")], fixture.name),
          );
          created.push(meta.id);
          data.assets.push({
            id: `${scene}-demo-${fixture.kind}`,
            name: `Mock · ${fixture.kind === "model" ? "气象观测塔" : fixture.kind === "video" ? "监测视频" : "站点说明"}`,
            kind: fixture.kind as "model" | "video" | "document",
            blobId: meta.id,
            fileName: meta.name,
            size: meta.size,
            ...(fixture.kind === "model"
              ? { scale: 1, heading: 0 }
              : { stationId: data.stations[0].id }),
          });
        }
        data.stations[0].modelId = data.assets[0].id;
        data.plans[0].points[0].modelId = data.assets[0].id;
        const parsed = parseBusinessData(data, scene);
        await this.files.validateReferences(
          user.tenantId,
          scene,
          parsed.assets,
        );
        await this.repo.saveBusiness(user.tenantId, scene, 0, parsed, user.id);
        return this.business(user, scene);
      } catch (error) {
        // 响应丢失也可能已提交：先核查仓库，绝不删除已被保存修订引用的文件。
        const saved = await this.repo.readBusiness(user.tenantId, scene);
        if (!saved)
          await Promise.all(
            created.map((id) =>
              this.files.remove(user.tenantId, scene, id).catch(() => {}),
            ),
          );
        throw error;
      }
    });
  }
  /** 按发布灰度规则返回活动快照；草稿只对有权限用户按业务规则读取。 */
  private async businessRaw(user: Principal, scene: string) {
    if (user.role === "viewer") {
      const active = await this.repo.activePublication(user.tenantId, scene);
      if (active && isPublicationCohort(user.id, active.trafficPercent ?? 100))
        return {
          revision: active.revision,
          data: parseBusinessData(active.snapshot, scene),
          owner: { id: user.id, tenantId: user.tenantId },
        };
      if (active?.previousRevision !== undefined) {
        const previous = (
          await this.repo.publications(user.tenantId, scene)
        ).find(
          (publication) => publication.revision === active.previousRevision,
        );
        if (previous)
          return {
            revision: previous.revision,
            data: parseBusinessData(previous.snapshot, scene),
            owner: { id: user.id, tenantId: user.tenantId },
          };
      }
    }
    // 只读账号只读取已激活快照；未激活时走明确的只读演示底图，不暴露草稿。
    const saved =
      user.role === "viewer"
        ? null
        : await this.repo.readBusiness(user.tenantId, scene);
    if (saved)
      return {
        revision: saved.revision,
        data: parseBusinessData(saved.data, scene),
        owner: { id: user.id, tenantId: user.tenantId },
      };
    const config = await this.scenarios.active(user.tenantId, scene);
    const data: BusinessData =
      user.kind === "demo"
        ? createDemoBusiness(config)
        : {
            version: 1,
            stations: demoStations(config).map((s, i) => ({
              ...s,
              type:
                i % 3 === 0 ? "雷达站" : i % 2 ? "国家无人站" : "国家有人站",
              status: "运行正常",
            })),
            plans: [],
            bookmarks: [],
            assets: [],
            users: [
              { id: "demo", name: "演示用户", role: "管理员", enabled: true },
            ],
          };
    return {
      revision: 0,
      data,
      owner: { id: user.id, tenantId: user.tenantId },
    };
  }
  async save(user: Principal, scene: string, body: unknown) {
    return this.locked(user, scene, () => this.saveUnlocked(user, scene, body));
  }
  /** 固化当前修订为不可变快照并写审计，之后还需另一位管理员审批。 */
  async publishBusiness(
    user: Principal,
    scene: string,
    revision: number,
    message: string,
  ) {
    await this.requireSettingsSection(user, "publications", scene);
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可发布业务修订");
    const current = await this.repo.readBusiness(user.tenantId, scene);
    if (!current || current.revision !== revision)
      throw new ConflictException("发布修订已变化，请重新加载");
    const result = await this.repo.publishBusiness(
      user.tenantId,
      scene,
      revision,
      user.id,
      message,
    );
    return {
      ...result,
      snapshot: await this.visibleBusiness(user, result.snapshot),
    };
  }
  async businessPublications(user: Principal, scene: string) {
    await this.requireSettingsSection(user, "publications", scene);
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可查看发布历史");
    const items = await this.repo.publications(user.tenantId, scene);
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        snapshot: await this.visibleBusiness(user, item.snapshot),
      })),
    );
  }
  async reviewBusinessPublication(
    user: Principal,
    scene: string,
    revision: number,
    decision: "approve" | "reject",
    message: string,
  ) {
    await this.requireSettingsSection(user, "publications", scene);
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可审批发布版本");
    const result = await this.repo.reviewPublication(
      user.tenantId,
      scene,
      revision,
      user.id,
      decision,
      message,
    );
    return {
      ...result,
      snapshot: await this.visibleBusiness(user, result.snapshot),
    };
  }
  /** 切换已审批快照，并记录上一活动版本供灰度和回滚使用。 */
  async activateBusinessPublication(
    user: Principal,
    scene: string,
    revision: number,
    trafficPercent: number,
  ) {
    await this.requireSettingsSection(user, "publications", scene);
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可激活发布版本");
    const result = await this.repo.activatePublication(
      user.tenantId,
      scene,
      revision,
      user.id,
      trafficPercent,
    );
    return {
      ...result,
      snapshot: await this.visibleBusiness(user, result.snapshot),
    };
  }
  async rollbackBusiness(
    user: Principal,
    scene: string,
    targetRevision: number,
    expectedRevision: number,
  ) {
    await this.requireSettingsSection(user, "publications", scene);
    if (user.role !== "admin")
      throw new ForbiddenException("仅管理员可回滚业务版本");
    return this.locked(user, scene, async () => {
      const publication = (
        await this.repo.publications(user.tenantId, scene)
      ).find((item) => item.revision === targetRevision);
      if (!publication) throw new ConflictException("发布版本不存在");
      let data: BusinessData;
      try {
        data = parseBusinessData(publication.snapshot, scene);
      } catch {
        throw new ConflictException("发布快照校验失败，无法回滚");
      }
      // 历史恢复同样受模块授权约束，不能绕过普通保存对隐藏集合的保护。
      const current = await this.businessRaw(user, scene);
      const grant = await this.licensing.status(
        user.tenantId,
        user.kind === "demo",
      );
      for (const [field, module] of [
        ["stations", "stations"],
        ["assets", "files"],
        ["plans", "roam"],
        ["bookmarks", "roam"],
      ] as const) {
        if (
          !grant.modules.includes(module) &&
          JSON.stringify(current.data[field]) !== JSON.stringify(data[field])
        )
          await this.module(user, scene, module);
      }
      await this.files.validateReferences(user.tenantId, scene, data.assets);
      const restored = await this.repo.rollbackBusiness(
        user.tenantId,
        scene,
        targetRevision,
        expectedRevision,
        user.id,
      );
      return {
        ...restored,
        data: await this.visibleBusiness(user, data),
        owner: { id: user.id, tenantId: user.tenantId },
      };
    });
  }
  private async saveUnlocked(user: Principal, scene: string, body: unknown) {
    const envelope = z
      .object({
        revision: z.number().int().nonnegative().max(2147483646),
        data: z.unknown(),
        owner: z.object({ id: z.string(), tenantId: z.string() }),
      })
      .safeParse(body);
    if (!envelope.success)
      throw new BadRequestException("业务修订请求格式错误");
    if (
      envelope.data.owner.id !== user.id ||
      envelope.data.owner.tenantId !== user.tenantId
    )
      throw new ForbiddenException("会话身份已变化，请重新加载资料");
    let data: BusinessData;
    try {
      data = parseBusinessData(envelope.data.data, scene);
    } catch {
      throw new BadRequestException(
        "业务资料校验失败，检查字段、地区和数量限制",
      );
    }
    const old = await this.businessRaw(user, scene);
    const visible = await this.visibleBusiness(user, old.data);
    const grant = await this.licensing.status(
      user.tenantId,
      user.kind === "demo",
    );
    for (const [field, module] of [
      ["stations", "stations"],
      ["assets", "files"],
      ["plans", "roam"],
      ["bookmarks", "roam"],
    ] as const) {
      if (!grant.modules.includes(module)) {
        if (JSON.stringify(data[field]) !== JSON.stringify(visible[field]))
          throw new ForbiddenException("不能修改未授权模块资料");
        Object.assign(data, { [field]: old.data[field] });
      }
    }
    for (const station of data.stations) {
      const previous = old.data.stations.find((s) => s.id === station.id);
      if (!grant.modules.includes("files")) {
        if (station.modelId && station.modelId !== previous?.modelId)
          throw new ForbiddenException("模型资料未授权");
        station.modelId = previous?.modelId;
      }
      if (!grant.modules.includes("roam")) {
        if (station.bookmarkId && station.bookmarkId !== previous?.bookmarkId)
          throw new ForbiddenException("视角资料未授权");
        station.bookmarkId = previous?.bookmarkId;
      }
    }
    if (!grant.modules.includes("files"))
      for (const plan of data.plans)
        for (const point of plan.points) {
          const previous = old.data.plans
            .find((p) => p.id === plan.id)
            ?.points.find((p) => p.id === point.id);
          if (point.modelId && point.modelId !== previous?.modelId)
            throw new ForbiddenException("模型资料未授权");
          point.modelId = previous?.modelId;
        }
    data = parseBusinessData(data, scene);
    if (
      user.role !== "admin" &&
      JSON.stringify(old.data.users) !== JSON.stringify(data.users)
    )
      throw new ForbiddenException("仅管理员可修改用户配置");
    await this.files.validateReferences(user.tenantId, scene, data.assets);
    const saved = await this.repo.saveBusiness(
      user.tenantId,
      scene,
      envelope.data.revision,
      data,
      user.id,
    );
    return {
      ...saved,
      data: await this.visibleBusiness(user, data),
      owner: { id: user.id, tenantId: user.tenantId },
    };
  }
}
let instance: Platform | undefined;
export function platform() {
  if (instance) return instance;
  const accounts = process.env.AUTH_USERS_FILE
    ? accountSchema.parse(
        JSON.parse(readFileSync(process.env.AUTH_USERS_FILE, "utf8")),
      )
    : [];
  if (new Set(accounts.map((a) => a.id)).size !== accounts.length)
    throw new Error("账号 ID 重复");
  const repo =
    process.env.DATABASE_URL || process.env.PGHOST
      ? new PostgresRepository(
          new Pool(
            process.env.DATABASE_URL
              ? { connectionString: process.env.DATABASE_URL }
              : undefined,
          ),
        )
      : new FileRepository(resolve(process.env.DATA_DIR ?? ".data"));
  instance = new Platform(
    repo,
    accounts,
    process.env.DEMO_ENABLED !== "false" &&
      process.env.DEPLOYMENT_MODE !== "production",
    resolve(process.env.DATA_DIR ?? ".data", "files"),
    process.env.AUTH_USERS_FILE,
  );
  return instance;
}
