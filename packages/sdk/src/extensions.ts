import { z } from "zod";
import { observationSchema, type DataFrame } from "@dtv/contracts";
const id = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+[a-z0-9.-]*$/);
const action = z
  .object({
    label: z.string().min(1).max(40),
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    height: z.number().min(100).max(10000000).optional(),
  })
  .strict();
export const RouteExtensionSchema = z
  .object({
    id,
    title: z.string().min(1).max(40),
    description: z.string().max(500).default(""),
    rows: z
      .array(
        z
          .object({ label: z.string().max(80), value: z.string().max(300) })
          .strict(),
      )
      .max(30)
      .default([]),
    action: action.optional(),
  })
  .strict();
export const WidgetExtensionSchema = z
  .object({
    id,
    title: z.string().min(1).max(60),
    value: z.string().max(100),
    description: z.string().max(300).default(""),
    action: action.optional(),
  })
  .strict();
export const StationProviderSchema = z
  .object({
    id,
    name: z.string().min(1).max(60),
    datasetKey: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,63}$/)
      .refine((v) => v !== "stations"),
    element: z
      .enum([
        "temperatureC",
        "rainfallMm",
        "windSpeedMs",
        "radarDbz",
        "cloudPercent",
        "windFieldMs",
        "relativeHumidity",
        "forecastTempC",
        "gridValue",
        "warningLevel",
        "simulationIntensity",
      ])
      .optional(),
    source: z.enum(["mock", "other", "tianqing"]),
    unit: z.string().max(20),
  })
  .strict();
export type RouteExtension = z.infer<typeof RouteExtensionSchema>;
export type WidgetExtension = z.infer<typeof WidgetExtensionSchema>;
export type StationProviderDescriptor = z.infer<typeof StationProviderSchema>;
type ExtensionValue =
  | RouteExtension
  | WidgetExtension
  | StationProviderDescriptor;
/** 所有注册必须带插件命名空间，防止覆盖核心菜单或卸载其他插件的内容。 */
export class ExtensionRegistry {
  private entries = new Map<
    string,
    {
      owner: string;
      kind: "route" | "widget" | "provider";
      value: ExtensionValue;
    }
  >();
  register(owner: string, kind: "route" | "widget" | "provider", raw: unknown) {
    const schema =
      kind === "route"
        ? RouteExtensionSchema
        : kind === "widget"
          ? WidgetExtensionSchema
          : StationProviderSchema;
    const value = schema.parse(raw);
    if (
      !value.id.startsWith(`${owner}.`) ||
      this.entries.has(value.id) ||
      [...this.entries.values()].filter((v) => v.owner === owner).length >= 24
    )
      throw new Error("扩展命名空间、重复项或数量无效");
    this.entries.set(value.id, { owner, kind, value });
  }
  remove(owner: string, id: string) {
    if (this.entries.get(id)?.owner === owner) this.entries.delete(id);
  }
  removeOwner(owner: string) {
    for (const [id, value] of this.entries)
      if (value.owner === owner) this.entries.delete(id);
  }
  owner(id: string) {
    return this.entries.get(id)?.owner;
  }
  routes() {
    return [...this.entries.values()]
      .filter((v) => v.kind === "route")
      .map((v) => v.value as RouteExtension);
  }
  widgets() {
    return [...this.entries.values()]
      .filter((v) => v.kind === "widget")
      .map((v) => v.value as WidgetExtension);
  }
  providers() {
    return [...this.entries.values()]
      .filter((v) => v.kind === "provider")
      .map((v) => v.value as StationProviderDescriptor);
  }
}
/** 返回合同化站点帧，逐条验证来源与时次；不把失败结果填成正常观测。 */
export function parseProviderFrame(
  raw: unknown,
  source: DataFrame["source"],
  time: string,
): DataFrame {
  const frame = z
    .object({
      source: z.enum(["mock", "tianqing", "other"]),
      observedAt: z.iso.datetime({ offset: true }),
      unit: z.string().max(20),
      crs: z.literal("EPSG:4326"),
      observations: z.array(observationSchema).max(2000),
    })
    .strict()
    .parse(raw);
  if (
    new Set(frame.observations.map((o) => o.stationId)).size !==
      frame.observations.length ||
    frame.source !== source ||
    Date.parse(frame.observedAt) !== Date.parse(time) ||
    frame.observations.some(
      (o) =>
        o.source !== source || Date.parse(o.observedAt) !== Date.parse(time),
    )
  )
    throw new Error("Provider来源或时次不一致");
  return frame;
}
/** 为跨沙箱异步调用统一处理取消、超时、迟到响应与卸载。 */
export class PluginRequests {
  private sequence = 0;
  private closed = false;
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      finish: () => void;
    }
  >();
  constructor(
    private send: (id: string, payload: unknown) => void,
    private timeout = 10000,
    private cancel?: (id: string) => void,
  ) {}
  request(payload: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.closed || signal?.aborted)
      return Promise.reject(
        new Error(this.closed ? "插件已卸载" : "请求已取消"),
      );
    if (this.pending.size >= 8)
      return Promise.reject(new Error("插件并发请求过多"));
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const fail = (message: string) => {
        const item = this.pending.get(id);
        if (!item) return;
        item.finish();
        this.cancel?.(id);
        reject(new Error(message));
      };
      const abort = () => fail("请求已取消"),
        timer = setTimeout(() => fail("Provider请求超时"), this.timeout);
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pending.delete(id);
      };
      this.pending.set(id, { resolve, reject, finish });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.send(id, payload);
      } catch {
        fail("插件请求发送失败");
      }
    });
  }
  resolve(id: string, value: unknown, error?: string) {
    const item = this.pending.get(id);
    if (!item) return false;
    item.finish();
    if (error) item.reject(new Error(error.slice(0, 200)));
    else item.resolve(value);
    return true;
  }
  dispose() {
    this.closed = true;
    for (const [id, item] of this.pending) {
      item.finish();
      this.cancel?.(id);
      item.reject(new Error("插件已卸载"));
    }
  }
}
