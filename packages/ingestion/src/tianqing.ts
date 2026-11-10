import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { observationSchema, type WeatherObservation } from "@dtv/contracts";

const fieldMapSchema = z.object({
  stationId: z.string().min(1),
  observedAt: z.string().min(1),
  longitude: z.string().min(1),
  latitude: z.string().min(1),
  temperatureC: z.string().optional(),
  rainfallMm: z.string().optional(),
  windSpeedMs: z.string().optional(),
}).strict();
const parameterKeySchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/);

const profileSchema = z.object({
  interfaceId: z.string().min(1),
  dataCode: z.string().min(1),
  elements: z.string().min(1),
  timeParameter: parameterKeySchema.default("times"),
  regionParameter: parameterKeySchema.default("adminCodes"),
  limitCnt: z.number().int().positive().max(10000).default(3000),
  requestTimeZone: z.enum(["UTC", "Asia/Shanghai"]).default("UTC"),
  observationTimeZone: z.enum(["UTC", "Asia/Shanghai"]).default("UTC"),
  extraParameters: z.record(parameterKeySchema, z.string()).default({}),
  fieldMap: fieldMapSchema,
  nullValues: z.array(z.string()).default(["////", "999999", "999999.0"]),
}).strict();

const regionSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().url(),
  userId: z.string().min(1),
  password: z.string().min(1),
  regionCode: z.string().min(1),
  serviceNodeId: z.string().min(1).optional(),
  profile: z.string().min(1),
}).strict();

const settingsSchema = z.object({
  profiles: z.record(z.string(), profileSchema).default({}),
  scenes: z.record(z.string(), regionSchema).default({}),
}).strict();

type Profile = z.infer<typeof profileSchema>;
export type TianqingRegionSettings = z.infer<typeof regionSchema>;
export interface TianqingConfig {
  profiles: Record<string, Profile>;
  scenes: Record<string, TianqingRegionSettings>;
}

const emptySettings = (): TianqingConfig => ({ profiles: {}, scenes: {} });

/** 按地区保存天擎接入参数；口令只在服务端内存中使用。 */
export class TianqingRegistry {
  constructor(private readonly settings: TianqingConfig) {}

  /** 按地区开关选择来源；未启用的地区始终走明确标记的 Mock。 */
  sourceForScene(sceneId: string): "mock" | "tianqing" {
    return this.settings.scenes[sceneId]?.enabled ? "tianqing" : "mock";
  }

  /** 返回地区凭据和通用产品 profile；错误时不回退为 Mock，避免误报实况。 */
  forScene(sceneId: string) {
    const region = this.settings.scenes[sceneId];
    if (!region?.enabled) return undefined;
    const profile = this.settings.profiles[region.profile];
    if (!profile) throw new Error(`地区 ${sceneId} 的天擎 profile 未配置`);
    return { region, profile };
  }
}

/** 读取服务端地区配置；缺少实际配置时安全回退到 Mock。 */
export function loadTianqingConfig(
  input?: unknown,
  sourceFile?: string,
): TianqingRegistry {
  let raw = input;
  if (raw === undefined) {
    const envFile = process.env.DTV_TIANQING_CONFIG_FILE;
    const path = sourceFile ?? envFile ??
      resolve(process.cwd(), "deploy/tianqing/sources.json");
    const required = sourceFile !== undefined || envFile !== undefined;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === "ENOENT" &&
        !required
      )
        return new TianqingRegistry(emptySettings());
      throw new Error("无法读取天擎地区配置，请检查配置文件存在性、格式和权限");
    }
  }
  // 读取后统一做严格 schema 校验，并验证 endpoint/profile 关联关系。
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) throw new Error("天擎地区配置格式无效");

  for (const [sceneId, region] of Object.entries(parsed.data.scenes)) {
    const endpoint = new URL(region.baseUrl);
    // 防止把凭据藏进 URL，也避免基础 query 参与顺序不确定的签名。
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    )
      throw new Error(`地区 ${sceneId} 的天擎 endpoint 不安全或包含 query`);
    if (!parsed.data.profiles[region.profile])
      throw new Error(`地区 ${sceneId} 引用了不存在的天擎 profile`);
  }
  return new TianqingRegistry(parsed.data);
}

/** 严格复刻方案中的签名：原始值、ASCII 键排序、UTF-8、MD5 大写。 */
export function signTianqingParameters(
  parameters: Record<string, string>,
  password: string,
): string {
  const signed: Record<string, string> = { ...parameters, pwd: password };
  const plain = Object.keys(signed)
    .sort()
    .map((key) => `${key}=${signed[key]}`)
    .join("&");
  return createHash("md5").update(plain, "utf8").digest("hex").toUpperCase();
}

/** Python quote_plus 兼容编码：签名不使用此编码结果。 */
function formEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** endpoint 不含 query；签名作为最终参数追加，口令永不进入 URL。 */
export function buildTianqingUrl(
  baseUrl: string,
  parameters: Record<string, string>,
  password: string,
): string {
  const query = Object.entries(parameters)
    .map(([key, value]) => `${formEncode(key)}=${formEncode(value)}`)
    .join("&");
  const signature = signTianqingParameters(parameters, password);
  return `${baseUrl}?${query}&sign=${signature}`;
}

/** 按 profile 指定时区拆分时次，避免依赖容器本地时区。 */
function dateParts(date: Date, timeZone: "UTC" | "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** 将 ISO 时次转成接口要求的紧凑年月日时分秒参数。 */
function formatTianqingTime(time: string, timeZone: "UTC" | "Asia/Shanghai") {
  const parts = dateParts(new Date(time), timeZone);
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

/** 天擎常见的紧凑时次没有时区，按 profile 显式时区解释，避免跟随主机时区。 */
function parseObservationTime(
  raw: unknown,
  timeZone: "UTC" | "Asia/Shanghai",
): string {
  const value = String(raw ?? "").trim();
  let date: Date;
  if (/^\d{14}$/.test(value) || /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)) {
    const digits = value.replace(/\D/g, "");
    const utc = Date.UTC(
      Number(digits.slice(0, 4)), Number(digits.slice(4, 6)) - 1,
      Number(digits.slice(6, 8)), Number(digits.slice(8, 10)),
      Number(digits.slice(10, 12)), Number(digits.slice(12, 14)),
    );
    date = new Date(utc - (timeZone === "Asia/Shanghai" ? 8 * 3600000 : 0));
  } else {
    date = new Date(value);
  }
  if (!Number.isFinite(date.getTime())) throw new Error("天擎观测时次格式无效");
  return date.toISOString();
}

/** 将天擎数值、空值标记统一映射为 number 或 null，拒绝非数值文本。 */
function numericField(
  row: Record<string, unknown>,
  field: string | undefined,
  nullValues: string[],
): number | null {
  if (!field) return null;
  const raw = row[field];
  const text = String(raw ?? "").trim();
  if (raw === null || raw === undefined || text === "" || nullValues.includes(text))
    return null;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new Error(`天擎数值字段 ${field} 格式无效`);
  return value;
}

export interface TianqingClientOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  nonce?: () => string;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const defaultWait = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolveWait, reject) => {
    if (signal?.aborted) return reject(new Error("天擎请求已取消"));
    const timer = setTimeout(resolveWait, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("天擎请求已取消"));
    }, { once: true });
  });

/** 负责协议签名、HTTP 重试和天擎字段到公共观测契约的映射。 */
export class TianqingClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly nonce: () => string;
  private readonly wait: NonNullable<TianqingClientOptions["wait"]>;

  constructor(
    private readonly registry: TianqingRegistry,
    options: TianqingClientOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.nonce = options.nonce ?? randomUUID;
    this.wait = options.wait ?? defaultWait;
  }

  /** 按地区 profile 组装签名请求，并校验响应时次、数量和观测字段。 */
  async fetch(
    sceneId: string,
    time: string,
    signal?: AbortSignal,
  ): Promise<WeatherObservation[]> {
    const settings = this.registry.forScene(sceneId);
    if (!settings) throw new Error("当前地区未启用天擎采集");
    const { region, profile } = settings;
    const params: Record<string, string> = {
      userId: region.userId,
      dataFormat: "json",
      timestamp: String(this.now()),
      nonce: this.nonce(),
      ...(region.serviceNodeId ? { serviceNodeId: region.serviceNodeId } : {}),
      interfaceId: profile.interfaceId,
      dataCode: profile.dataCode,
      elements: profile.elements,
      [profile.timeParameter]: formatTianqingTime(time, profile.requestTimeZone),
      [profile.regionParameter]: region.regionCode,
      limitCnt: String(profile.limitCnt),
    };
    for (const [key, value] of Object.entries(profile.extraParameters)) {
      if ([
        "pwd", "sign", "userId", "timestamp", "nonce", "dataFormat",
        "serviceNodeId", "interfaceId", "dataCode", "elements", "limitCnt",
        profile.timeParameter, profile.regionParameter,
      ].includes(key))
        throw new Error("天擎 profile 覆盖了保留的鉴权参数");
      params[key] = value
        .replaceAll("{regionCode}", region.regionCode)
        .replaceAll("{time}", formatTianqingTime(time, profile.requestTimeZone));
    }

    const url = buildTianqingUrl(region.baseUrl, params, region.password);
    const response = await this.request(url, signal);
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 10 * 1024 * 1024)
      throw new Error("天擎响应超过 10 MB 限制");
    let payload: { returnCode?: number | string; DS?: unknown } | null;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = null;
    }
    if (!payload || String(payload.returnCode) !== "0" || !Array.isArray(payload.DS))
      throw new Error("天擎返回业务错误或响应结构无效");
    if (payload.DS.length === 0) throw new Error("天擎该时次未返回观测数据");
    if (payload.DS.length >= profile.limitCnt)
      throw new Error("天擎返回行数达到 limitCnt，疑似截断，已拒绝写入");

    const expectedTime = new Date(time).toISOString();
    const ingestedAt = new Date(this.now()).toISOString();
    return payload.DS.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("天擎观测记录格式无效");
      const row = value as Record<string, unknown>;
      const mapped = {
        source: "tianqing" as const,
        stationId: String(row[profile.fieldMap.stationId] ?? "").trim(),
        observedAt: parseObservationTime(
          row[profile.fieldMap.observedAt], profile.observationTimeZone,
        ),
        ingestedAt,
        location: {
          lon: numericField(row, profile.fieldMap.longitude, profile.nullValues),
          lat: numericField(row, profile.fieldMap.latitude, profile.nullValues),
          crs: "EPSG:4326" as const,
        },
        elements: {
          temperatureC: numericField(row, profile.fieldMap.temperatureC, profile.nullValues),
          rainfallMm: numericField(row, profile.fieldMap.rainfallMm, profile.nullValues),
          windSpeedMs: numericField(row, profile.fieldMap.windSpeedMs, profile.nullValues),
        },
        quality: { adapter: "tianqing" },
      };
      const parsed = observationSchema.safeParse(mapped);
      if (!parsed.success) throw new Error("天擎字段映射或观测值校验失败");
      if (parsed.data.observedAt !== expectedTime)
        throw new Error("天擎响应观测时次与任务时次不一致");
      return parsed.data;
    });
  }

  /** 只对限流、服务端错误和网络异常退避重试，不重试业务拒绝。 */
  private async request(url: string, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) throw new Error("天擎请求已取消");
      try {
        const timeout = AbortSignal.timeout(10000);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await this.fetcher(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: requestSignal,
          redirect: "error",
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 3) {
            await this.wait(1000 * 2 ** (attempt - 1), signal);
            continue;
          }
          throw new Error(`天擎暂时不可用（HTTP ${response.status}）`);
        }
        if (!response.ok) throw new Error(`天擎拒绝请求（HTTP ${response.status}）`);
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > 10 * 1024 * 1024) throw new Error("天擎响应超过 10 MB 限制");
        return response;
      } catch (error) {
        if (signal?.aborted) throw new Error("天擎请求已取消");
        if (error instanceof Error && /拒绝请求|超过 10 MB/.test(error.message))
          throw error;
        if (attempt >= 3) throw new Error("天擎连接失败或重试次数已用尽");
        await this.wait(1000 * 2 ** (attempt - 1), signal);
      }
    }
    throw new Error("天擎连接失败");
  }
}
