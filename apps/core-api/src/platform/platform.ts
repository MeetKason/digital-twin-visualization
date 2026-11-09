import { readFileSync } from "node:fs";
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
import { AuthService } from "./auth";
import { FileStore } from "./files";
import { FileIngestionStore } from "../../../../packages/ingestion/src/file";
import { PostgresIngestionStore } from "../../../../packages/ingestion/src/postgres";
import { QueueWorker } from "../../../../packages/ingestion/src/worker";
import type { IngestionStore } from "../../../../packages/ingestion/src/state";
import { DemoService } from "../service";
import {
  demoStations,
  parseBusinessData,
  type BusinessData,
} from "@dtv/contracts";
const accountSchema = z.array(
  z.object({
    id: z.string().min(1),
    tenantId: z.string().min(1),
    role: z.enum(["admin", "editor", "viewer"]),
    scenes: z.array(z.enum(["xian", "taiyuan", "chengdu"])).min(1),
    passwordHash: z.string().regex(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/),
    disabled: z.boolean().optional(),
  }),
);
export type Request = IncomingMessage & { ip?: string };
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
  readonly ingestion: IngestionStore;
  private timer?: ReturnType<typeof setInterval>;
  private executing: Promise<unknown> | null = null;
  start() {
    if (this.timer || this.repo instanceof PostgresRepository) return;
    const worker = new QueueWorker(this.ingestion);
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
  async removeFile(user: Principal, scene: string, id: string) {
    return this.locked(user, scene, async () => {
      if (
        (await this.business(user, scene)).data.assets.some(
          (a) => a.blobId === id,
        )
      )
        throw new ConflictException("文件仍被业务资料引用，请先移除引用并保存");
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
  ) {
    this.files = new FileStore(fileRoot);
    this.ingestion =
      repo instanceof PostgresRepository
        ? new PostgresIngestionStore(repo.pool)
        : new FileIngestionStore(resolve(fileRoot, ".."));
    this.auth = new AuthService(repo, accounts, allowDemo);
  }
  async current(req: Request): Promise<Principal> {
    const user = await this.auth.resolve(sessionToken(req));
    if (!user) throw new UnauthorizedException("请先登录");
    return user;
  }
  async access(req: Request, scene: string, write = false) {
    if (write) writeBoundary(req);
    const user = await this.current(req);
    this.demo.scene(scene);
    await this.auth.authorize(user, scene, write);
    return user;
  }
  async business(user: Principal, scene: string) {
    const saved = await this.repo.readBusiness(user.tenantId, scene);
    if (saved)
      return {
        revision: saved.revision,
        data: parseBusinessData(saved.data, scene),
        owner: { id: user.id, tenantId: user.tenantId },
      };
    const config = this.demo.scene(scene);
    const data: BusinessData = {
      version: 1,
      stations: demoStations(config).map((s, i) => ({
        ...s,
        type: i % 3 === 0 ? "雷达站" : i % 2 ? "国家无人站" : "国家有人站",
        status: "运行正常",
      })),
      plans: [],
      bookmarks: [],
      assets: [],
      users: [{ id: "demo", name: "演示用户", role: "管理员", enabled: true }],
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
    const old = await this.business(user, scene);
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
    return { ...saved, owner: { id: user.id, tenantId: user.tenantId } };
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
  );
  return instance;
}
