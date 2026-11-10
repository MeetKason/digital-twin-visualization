import { randomUUID } from "node:crypto";
import {
  ingestionRequest,
  observationSchema,
  type IngestionRequest,
  type IngestionJob,
  type IngestionStatus,
  type WeatherObservation,
} from "@dtv/contracts";
import type { IngestionMetricSnapshot } from "./metrics";
import {
  defaultIngestionProducts,
  validateProductRegistry,
  type IngestionProduct,
} from "./products";
export class IngestionError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}
export const HOUR = 3600000,
  LEASE_MS = 120000;
type InternalJob = IngestionJob & { leaseToken?: string; leaseUntil?: number };
export interface ScopeState extends Omit<IngestionStatus, "jobs"> {
  tenantId: string;
  sceneId: string;
  jobs: InternalJob[];
  frames: Record<string, WeatherObservation[]>;
  productSchedules: Record<string, { enabled: boolean; lastEnqueuedAt: string | null }>;
  productProgress: Record<string, { watermark: string | null; lastSuccessAt: string | null }>;
}
export interface Lease {
  tenantId: string;
  sceneId: string;
  job: IngestionJob;
  token: string;
}
export type States = Record<string, ScopeState>;
export type IngestionSource = "mock" | "tianqing";
export type WriteRows = (
  state: ScopeState,
  rows: WeatherObservation[],
  productId: string,
) => Promise<void>;
export const scopeKey = (tenant: string, scene: string) =>
  JSON.stringify([tenant, scene]);
export const frameKey = (productId: string, time: string) =>
  JSON.stringify([productId, time]);
export const newScope = (
  tenantId: string,
  sceneId: string,
  source: IngestionSource = "mock",
): ScopeState => ({
  tenantId,
  sceneId,
  productId: "surface-hourly",
  source,
  mode: "demo",
  watermark: null,
  lastSuccessAt: null,
  schedule: { enabled: false, lastEnqueuedAt: null },
  jobs: [],
  frames: {},
  productSchedules: {},
  productProgress: {},
});
export abstract class IngestionStore {
  constructor(
    private readonly resolveSource: (sceneId: string, productId?: string) => IngestionSource = () =>
      "mock",
    private readonly products: IngestionProduct[] = defaultIngestionProducts,
  ) { validateProductRegistry(products); }

  protected abstract transaction<T>(
    scope: [string, string] | null,
    work: (states: States, write: WriteRows, clock: number) => Promise<T>,
  ): Promise<T>;
  productCatalog(): IngestionProduct[] {
    return structuredClone(this.products);
  }
  /** 汇总不带租户、站点和凭据标签的计数，避免指标暴露业务维度。 */
  async metricsSnapshot(): Promise<IngestionMetricSnapshot> {
    return this.transaction(null, async (states) => {
      const counts = new Map<string, number>();
      let enabledSchedules = 0;
      for (const state of Object.values(states)) {
        if (state.schedule.enabled) enabledSchedules++;
        enabledSchedules += Object.values(state.productSchedules ?? {}).filter((schedule) => schedule.enabled).length;
        for (const job of state.jobs) {
          const key = JSON.stringify([job.source, job.status]);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      return {
        jobs: [...counts].map(([key, count]) => {
          const [source, status] = JSON.parse(key) as [string, string];
          return { source, status, count };
        }),
        enabledSchedules,
      };
    });
  }
  /** 读取或初始化租户/场景队列，并处理来源切换后的水位重置。 */
  private get(states: States, tenant: string, scene: string) {
    const state = (states[scopeKey(tenant, scene)] ??= newScope(
      tenant,
      scene,
      this.resolveSource(scene),
    ));
    state.productId ??= "surface-hourly";
    state.productSchedules ??= {};
    state.productProgress ??= {};
    for (const job of state.jobs) job.productId ??= "surface-hourly";
    // 地区当前来源只由服务端配置决定，不读取客户端提交的来源字段。
    const configuredSource = this.resolveSource(scene);
    if (state.source !== configuredSource) {
      // 切换来源后不把上一来源的水位和计划时间显示成当前源的进度。
      state.source = configuredSource;
      state.watermark = null;
      state.lastSuccessAt = null;
      state.schedule.lastEnqueuedAt = null;
      state.productProgress = {};
      for (const schedule of Object.values(state.productSchedules))
        schedule.lastEnqueuedAt = null;
    }
    return state;
  }
  async status(tenant: string, scene: string): Promise<IngestionStatus> {
    return this.productStatus(tenant, scene, "surface-hourly");
  }
  /** 返回单产品进度；内部租约令牌始终从公开任务视图剔除。 */
  async productStatus(tenant: string, scene: string, productId: string): Promise<IngestionStatus> {
    return this.transaction([tenant, scene], async (states) => {
      const state = this.get(states, tenant, scene);
      const product = this.products.find((item) => item.id === productId);
      if (!product) throw new IngestionError("采集产品不存在", 404);
      const schedule = productId === "surface-hourly"
        ? state.schedule
        : (state.productSchedules[productId] ??= { enabled: false, lastEnqueuedAt: null });
      const progress = state.productProgress[productId] ?? {
        watermark: productId === "surface-hourly" ? state.watermark : null,
        lastSuccessAt: productId === "surface-hourly" ? state.lastSuccessAt : null,
      };
      return {
        productId,
        source: this.resolveSource(scene, productId),
        mode: state.mode,
        watermark: progress.watermark,
        lastSuccessAt: progress.lastSuccessAt,
        schedule: { ...schedule },
        jobs: state.jobs
          .filter((job) => (job.productId ?? "surface-hourly") === productId)
          .slice()
          .reverse()
          .map((job) => {
            const view = { ...job };
            delete view.leaseToken;
            delete view.leaseUntil;
            return view;
          }),
      };
    });
  }
  /** 设置查询模式或产品调度开关，未注册的连接器不能被启用。 */
  async configure(
    tenant: string,
    scene: string,
    patch: { mode?: "demo" | "ingested"; enabled?: boolean; productId?: string },
  ) {
    await this.transaction([tenant, scene], async (states) => {
      const state = this.get(states, tenant, scene);
      const productId = patch.productId ?? "surface-hourly";
      const product = this.products.find((item) => item.id === productId);
      if (!product) throw new IngestionError("采集产品不存在", 404);
      if (patch.enabled && !product.available) throw new IngestionError("该产品尚未接入采集连接器", 409);
      if (patch.mode !== undefined) state.mode = patch.mode;
      if (patch.enabled !== undefined) {
        const schedule = productId === "surface-hourly"
          ? state.schedule
          : (state.productSchedules[productId] ??= { enabled: false, lastEnqueuedAt: null });
        schedule.enabled = patch.enabled;
      }
    });
    return this.productStatus(tenant, scene, patch.productId ?? "surface-hourly");
  }
  /** 校验时次、产品、来源和队列容量，再创建幂等任务记录。 */
  private add(
    state: ScopeState,
    input: IngestionRequest,
    actor: string,
    kind: "manual" | "scheduled",
    clock: number,
  ): IngestionJob {
    const parsed = ingestionRequest.safeParse(input);
    if (!parsed.success)
      throw new IngestionError(
        "来源或时次范围无效：必须匹配地区服务端配置，且为最多168小时的整点时次",
      );
    const product = this.products.find((item) => item.id === parsed.data.productId);
    if (!product) throw new IngestionError("采集产品不存在", 404);
    if (!product.available) throw new IngestionError("该产品尚未接入采集连接器", 409);
    if (Date.parse(parsed.data.endTime) > Math.floor(clock / HOUR) * HOUR)
      throw new IngestionError("不能采集未来时次");
    const { startTime, endTime } = parsed.data;
    if (parsed.data.source !== this.resolveSource(state.sceneId, parsed.data.productId))
      throw new IngestionError("采集来源与地区服务端配置不匹配", 409);
    const existing = state.jobs.find(
      (j) =>
        j.source === parsed.data.source &&
        (j.productId ?? "surface-hourly") === parsed.data.productId &&
        j.startTime === startTime &&
        j.endTime === endTime &&
        j.status !== "cancelled",
    );
    if (existing) return { ...existing };
    if (
      state.jobs.filter((j) =>
        ["queued", "running", "retrying"].includes(j.status),
      ).length >= 20
    )
      throw new IngestionError("最多20个待完成任务", 409);
    while (state.jobs.length >= 200) {
      const index = state.jobs.findIndex((j) =>
        ["succeeded", "cancelled"].includes(j.status),
      );
      if (index < 0)
        throw new IngestionError("任务记录已满，请先处理失败任务", 409);
      state.jobs.splice(index, 1);
    }
    const now = new Date(clock).toISOString();
    const job: InternalJob = {
      id: randomUUID(),
      productId: parsed.data.productId,
      source: parsed.data.source,
      kind,
      startTime,
      endTime,
      cursor: startTime,
      status: "queued",
      attempts: 0,
      completedHours: 0,
      totalHours: (Date.parse(endTime) - Date.parse(startTime)) / HOUR + 1,
      rowCount: 0,
      error: null,
      nextAt: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
    };
    state.jobs.push(job);
    return { ...job };
  }
  private addWithDependencies(
    state: ScopeState,
    input: IngestionRequest,
    actor: string,
    kind: "manual" | "scheduled",
    clock: number,
    seen = new Set<string>(),
  ): IngestionJob {
    const parsed = ingestionRequest.parse(input);
    const product = this.products.find((item) => item.id === parsed.productId);
    if (!product) throw new IngestionError("采集产品不存在", 404);
    if (!product.available) throw new IngestionError("该产品尚未接入采集连接器", 409);
    if (seen.has(product.id)) throw new IngestionError("采集产品依赖循环", 409);
    const nextSeen = new Set(seen).add(product.id);
    for (const dependencyId of product.dependencies) {
      const dependency = this.products.find((item) => item.id === dependencyId)!;
      if (!dependency.available)
        throw new IngestionError(`依赖产品 ${dependency.label} 尚未接入`, 409);
      this.addWithDependencies(
        state,
        { ...parsed, productId: dependency.id },
        actor,
        kind,
        clock,
        nextSeen,
      );
    }
    return this.add(state, parsed, actor, kind, clock);
  }
  async enqueue(
    tenant: string,
    scene: string,
    input: IngestionRequest,
    actor: string,
  ) {
    return this.transaction([tenant, scene], async (states, _write, clock) => {
      const state = this.get(states, tenant, scene);
      const parsed = ingestionRequest.safeParse(input);
      if (!parsed.success) return this.add(state, input, actor, "manual", clock);
      return this.addWithDependencies(state, parsed.data, actor, "manual", clock);
    });
  }
  /** 自动入队到期计划、等待产品依赖，并原子租约最早可执行任务。 */
  async claim(_worker: string, fixedNow?: number): Promise<Lease | null> {
    return this.transaction(null, async (states, _write, clock) => {
      const now = fixedNow ?? clock;
      for (const state of Object.values(states)) {
        this.get(states, state.tenantId, state.sceneId);
        const schedules = [{ productId: "surface-hourly", config: state.schedule }, ...Object.entries(state.productSchedules).map(([productId, config]) => ({ productId, config }))];
        for (const { productId, config } of schedules) if (config.enabled) {
          const hour = Math.floor(now / HOUR) * HOUR;
          let next = config.lastEnqueuedAt
            ? Math.max(
                Date.parse(config.lastEnqueuedAt) + HOUR,
                hour - 23 * HOUR,
              )
            : hour;
          while (next <= hour) {
            try {
              this.addWithDependencies(
                state,
                {
                  source: this.resolveSource(state.sceneId, productId),
                  productId,
                  startTime: new Date(next).toISOString(),
                  endTime: new Date(next).toISOString(),
                },
                "schedule",
                "scheduled",
                now,
              );
            } catch (e) {
              if (e instanceof IngestionError && e.status === 409) break;
              throw e;
            }
            config.lastEnqueuedAt = new Date(next).toISOString();
            next += HOUR;
          }
        }
        for (const job of state.jobs) {
          const productId = job.productId ?? "surface-hourly";
          const product = this.products.find((item) => item.id === productId);
          if (!product) {
            job.status = "failed";
            job.error = "采集产品注册已移除";
            continue;
          }
          const dependencyState = product.dependencies.map((dependencyId) => {
            const candidates = state.jobs.filter((candidate) =>
              (candidate.productId ?? "surface-hourly") === dependencyId &&
              candidate.source === job.source && candidate.startTime <= job.cursor && candidate.endTime >= job.cursor,
            );
            const dependency = candidates.find((candidate) => candidate.status === "succeeded") ??
              candidates.find((candidate) => ["queued", "running", "retrying"].includes(candidate.status)) ??
              candidates[0];
            return dependency?.status === "succeeded" ? "ready" : ["failed", "cancelled"].includes(dependency?.status ?? "") ? "failed" : "waiting";
          });
          if (dependencyState.includes("failed")) {
            job.status = "failed";
            job.error = "依赖产品任务失败，需先恢复上游产品";
            continue;
          }
          if (dependencyState.includes("waiting")) continue;
          if (job.status === "running" && (job.leaseUntil ?? 0) <= now) {
            job.status = job.attempts >= 3 ? "failed" : "retrying";
            job.error = "执行租约过期，可恢复未完成时次";
            job.nextAt = now;
            delete job.leaseToken;
            delete job.leaseUntil;
          }
          if (!["queued", "retrying"].includes(job.status) || job.nextAt > now)
            continue;
          job.status = "running";
          job.attempts++;
          job.updatedAt = new Date(now).toISOString();
          job.leaseToken = randomUUID();
          job.leaseUntil = now + LEASE_MS;
          return {
            tenantId: state.tenantId,
            sceneId: state.sceneId,
            job: { ...job },
            token: job.leaseToken,
          };
        }
      }
      return null;
    });
  }
  private current(state: ScopeState, lease: Lease, now: number) {
    return state.jobs.find(
      (j) =>
        j.id === lease.job.id &&
        j.status === "running" &&
        j.leaseToken === lease.token &&
        (j.leaseUntil ?? 0) > now,
    );
  }
  /** 以租约令牌确认任务仍归当前 Worker，再原子保存观测与进度。 */
  async complete(
    lease: Lease,
    rows: WeatherObservation[],
    fixedNow?: number,
  ): Promise<boolean> {
    return this.transaction(
      [lease.tenantId, lease.sceneId],
      async (states, write, clock) => {
        const now = fixedNow ?? clock;
        const state = this.get(states, lease.tenantId, lease.sceneId),
          job = this.current(state, lease, now);
        if (!job) return false;
        if (
          !rows.length ||
          rows.length > 10000 ||
          new Set(rows.map((r) => r.stationId)).size !== rows.length ||
          rows.some(
            (r) =>
              !observationSchema.safeParse(r).success ||
              r.source !== job.source ||
              new Date(r.observedAt).toISOString() !== job.cursor,
          )
        )
          throw new IngestionError("观测契约校验失败");
        await write(state, rows, job.productId ?? "surface-hourly");
        const completedAt = new Date(now).toISOString();
        if (job.source === this.resolveSource(state.sceneId, job.productId ?? "surface-hourly")) {
          const productId = job.productId ?? "surface-hourly";
          const progress = (state.productProgress[productId] ??= {
            watermark: productId === "surface-hourly" ? state.watermark : null,
            lastSuccessAt: productId === "surface-hourly" ? state.lastSuccessAt : null,
          });
          progress.watermark = !progress.watermark || job.cursor > progress.watermark ? job.cursor : progress.watermark;
          progress.lastSuccessAt = completedAt;
          if (productId === "surface-hourly") {
            state.watermark = progress.watermark;
            state.lastSuccessAt = progress.lastSuccessAt;
          }
        }
        job.completedHours++;
        job.rowCount += rows.length;
        job.attempts = 0;
        job.error = null;
        job.updatedAt = completedAt;
        delete job.leaseToken;
        delete job.leaseUntil;
        if (job.cursor === job.endTime) job.status = "succeeded";
        else {
          job.cursor = new Date(Date.parse(job.cursor) + HOUR).toISOString();
          job.status = "queued";
          job.nextAt = 0;
        }
        return true;
      },
    );
  }
  /** 记录脱敏错误并按退避策略重试；超过次数后进入失败终态。 */
  async fail(lease: Lease, message: string, fixedNow?: number) {
    return this.transaction(
      [lease.tenantId, lease.sceneId],
      async (states, _write, clock) => {
        const now = fixedNow ?? clock;
        const job = this.current(
          this.get(states, lease.tenantId, lease.sceneId),
          lease,
          now,
        );
        if (!job) return false;
        job.status = job.attempts >= 3 ? "failed" : "retrying";
        job.error = message.slice(0, 300);
        job.updatedAt = new Date(now).toISOString();
        job.nextAt = now + 5000 * 2 ** (job.attempts - 1);
        delete job.leaseToken;
        delete job.leaseUntil;
        return true;
      },
    );
  }
  async retry(tenant: string, scene: string, id: string) {
    return this.transaction([tenant, scene], async (states) => {
      const job = this.get(states, tenant, scene).jobs.find((j) => j.id === id);
      if (!job) throw new IngestionError("任务不存在", 404);
      if (job.status !== "failed")
        throw new IngestionError("仅失败任务可人工重试", 409);
      if (
        this.get(states, tenant, scene).jobs.filter((j) =>
          ["queued", "running", "retrying"].includes(j.status),
        ).length >= 20
      )
        throw new IngestionError("最多20个待完成任务", 409);
      job.status = "queued";
      job.attempts = 0;
      job.nextAt = 0;
      job.error = null;
      job.updatedAt = new Date().toISOString();
      return { ...job };
    });
  }
  async cancel(tenant: string, scene: string, id: string) {
    return this.transaction([tenant, scene], async (states) => {
      const job = this.get(states, tenant, scene).jobs.find((j) => j.id === id);
      if (!job) throw new IngestionError("任务不存在", 404);
      if (["succeeded", "cancelled"].includes(job.status))
        throw new IngestionError("任务已结束", 409);
      job.status = "cancelled";
      delete job.leaseToken;
      delete job.leaseUntil;
      job.updatedAt = new Date().toISOString();
      return { ...job };
    });
  }
  async times(tenant: string, scene: string, productId = "surface-hourly"): Promise<string[]> {
    return this.transaction([tenant, scene], async (states) => {
      const state = this.get(states, tenant, scene);
      return Object.entries(state.frames)
        .filter(([key, rows]) => {
          let belongsToProduct = productId === "surface-hourly";
          try {
            belongsToProduct = JSON.parse(key)[0] === productId;
          } catch {
            // 旧版文件仓库以时次字符串作为 key，升级后归属默认产品。
          }
          return belongsToProduct && rows.some((row) => row.source === this.resolveSource(scene, productId));
        })
        .map(([key]) => key.startsWith("[") ? JSON.parse(key)[1] as string : key)
        .sort();
    });
  }
  async observations(
    tenant: string,
    scene: string,
    time: string,
    productId = "surface-hourly",
  ): Promise<WeatherObservation[]> {
    return this.transaction([tenant, scene], async (states) => {
      const state = this.get(states, tenant, scene);
      return structuredClone(
        (state.frames[frameKey(productId, time)] ?? (productId === "surface-hourly" ? state.frames[time] : undefined) ?? []).filter((row) => row.source === this.resolveSource(scene, productId)),
      );
    });
  }

  sourceForScene(sceneId: string, productId = "surface-hourly"): IngestionSource {
    return this.resolveSource(sceneId, productId);
  }
}
