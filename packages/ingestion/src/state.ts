import { randomUUID } from "node:crypto";
import {
  ingestionRequest,
  observationSchema,
  type IngestionRequest,
  type IngestionJob,
  type IngestionStatus,
  type WeatherObservation,
} from "@dtv/contracts";
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
}
export interface Lease {
  tenantId: string;
  sceneId: string;
  job: IngestionJob;
  token: string;
}
export type States = Record<string, ScopeState>;
export type WriteRows = (
  state: ScopeState,
  rows: WeatherObservation[],
) => Promise<void>;
export const scopeKey = (tenant: string, scene: string) =>
  JSON.stringify([tenant, scene]);
export const newScope = (tenantId: string, sceneId: string): ScopeState => ({
  tenantId,
  sceneId,
  source: "mock",
  mode: "demo",
  watermark: null,
  lastSuccessAt: null,
  schedule: { enabled: false, lastEnqueuedAt: null },
  jobs: [],
  frames: {},
});
export abstract class IngestionStore {
  protected abstract transaction<T>(
    scope: [string, string] | null,
    work: (states: States, write: WriteRows, clock: number) => Promise<T>,
  ): Promise<T>;
  private get(states: States, tenant: string, scene: string) {
    return (states[scopeKey(tenant, scene)] ??= newScope(tenant, scene));
  }
  async status(tenant: string, scene: string): Promise<IngestionStatus> {
    return this.transaction([tenant, scene], async (states) => {
      const state = this.get(states, tenant, scene);
      return {
        source: "mock",
        mode: state.mode,
        watermark: state.watermark,
        lastSuccessAt: state.lastSuccessAt,
        schedule: { ...state.schedule },
        jobs: state.jobs
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
  async configure(
    tenant: string,
    scene: string,
    patch: { mode?: "demo" | "ingested"; enabled?: boolean },
  ) {
    await this.transaction([tenant, scene], async (states) => {
      const state = this.get(states, tenant, scene);
      if (patch.mode !== undefined) state.mode = patch.mode;
      if (patch.enabled !== undefined) state.schedule.enabled = patch.enabled;
    });
    return this.status(tenant, scene);
  }
  private add(
    state: ScopeState,
    input: IngestionRequest,
    actor: string,
    kind: "manual" | "scheduled",
    clock: number,
  ): IngestionJob {
    const parsed = ingestionRequest.safeParse(input);
    if (
      !parsed.success ||
      Date.parse(parsed.data.endTime) > Math.floor(clock / HOUR) * HOUR
    )
      throw new IngestionError(
        "源或时次范围无效：只支持 Mock，整点时次，最多168小时且不能采集未来",
      );
    const { startTime, endTime } = parsed.data;
    const existing = state.jobs.find(
      (j) =>
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
      source: "mock",
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
  async enqueue(
    tenant: string,
    scene: string,
    input: IngestionRequest,
    actor: string,
  ) {
    return this.transaction([tenant, scene], async (states, _write, clock) =>
      this.add(this.get(states, tenant, scene), input, actor, "manual", clock),
    );
  }
  async claim(_worker: string, fixedNow?: number): Promise<Lease | null> {
    return this.transaction(null, async (states, _write, clock) => {
      const now = fixedNow ?? clock;
      for (const state of Object.values(states)) {
        if (state.schedule.enabled) {
          const hour = Math.floor(now / HOUR) * HOUR;
          let next = state.schedule.lastEnqueuedAt
            ? Math.max(
                Date.parse(state.schedule.lastEnqueuedAt) + HOUR,
                hour - 23 * HOUR,
              )
            : hour;
          while (next <= hour) {
            try {
              this.add(
                state,
                {
                  source: "mock",
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
            state.schedule.lastEnqueuedAt = new Date(next).toISOString();
            next += HOUR;
          }
        }
        for (const job of state.jobs) {
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
        await write(state, rows);
        state.watermark =
          !state.watermark || job.cursor > state.watermark
            ? job.cursor
            : state.watermark;
        state.lastSuccessAt = new Date(now).toISOString();
        job.completedHours++;
        job.rowCount += rows.length;
        job.attempts = 0;
        job.error = null;
        job.updatedAt = state.lastSuccessAt;
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
  async times(tenant: string, scene: string): Promise<string[]> {
    return this.transaction([tenant, scene], async (states) =>
      Object.keys(this.get(states, tenant, scene).frames).sort(),
    );
  }
  async observations(
    tenant: string,
    scene: string,
    time: string,
  ): Promise<WeatherObservation[]> {
    return this.transaction([tenant, scene], async (states) =>
      structuredClone(this.get(states, tenant, scene).frames[time] ?? []),
    );
  }
}
