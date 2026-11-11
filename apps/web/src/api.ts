import { activateSession, closeSession, sessionFetch } from "./sessionRequest";
import type {
  SceneConfig,
  LayerDescriptor,
  Station,
  SearchResult,
  DataFrame,
} from "@dtv/contracts";
async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await (url.startsWith("/auth/") ? fetch : sessionFetch)(
    `/api${url}`,
    { signal },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "服务不可用" }));
    throw Object.assign(
      new Error(typeof body.message === "string" ? body.message : "请求失败"),
      { status: response.status },
    );
  }
  return response.json() as Promise<T>;
}
// 只读请求统一走相对 /api 路径，沿用同源会话并支持取消过期页面请求。
export const api = {
  ingestion: (sceneId: string, signal?: AbortSignal) =>
    get<import("@dtv/contracts").IngestionStatus>(
      `/scenes/${sceneId}/ingestion`,
      signal,
    ),
  ingestionHealth: (sceneId: string, signal?: AbortSignal) =>
    get<import("@dtv/contracts").IngestionHealth>(
      `/scenes/${sceneId}/ingestion/health`,
      signal,
    ),
  scenes: (signal?: AbortSignal) => get<SceneConfig[]>("/scenes", signal),
  layers: (id: string, signal?: AbortSignal) =>
    get<LayerDescriptor[]>(`/scenes/${id}/layers`, signal),
  stations: (id: string, signal?: AbortSignal) =>
    get<Station[]>(`/scenes/${id}/stations`, signal),
  times: (id: string, sceneId: string, signal?: AbortSignal) =>
    get<string[]>(
      `/layers/${id}/times?${new URLSearchParams({ sceneId })}`,
      signal,
    ),
  data: (id: string, sceneId: string, time: string, signal?: AbortSignal) =>
    get<DataFrame>(
      `/layers/${id}/data?${new URLSearchParams({ sceneId, time })}`,
      signal,
    ),
  search: (sceneId: string, q: string, signal?: AbortSignal) =>
    get<SearchResult>(`/search?${new URLSearchParams({ sceneId, q })}`, signal),
};
export interface RuntimeConfig {
  mode: "demo";
  /** 仅由登录后的 API 配置接口下发，供浏览器端 Key 访问天地图。 */
  tiandituKey?: string;
  /** 仅由登录后的 API 配置接口按需下发，供 Cesium 请求 ion 地形。 */
  cesiumIonAccessToken?: string;
  basemap: null | {
    type: "xyz" | "wmts" | "tianditu";
    url?: string;
    layer?: string;
    style?: string;
    format?: string;
    tileMatrixSetID?: string;
    defaultLayer?: "img_w" | "vec_w" | "ter_w";
  };
  terrainUrl: string | null;
  notice: string;
}
export async function runtimeConfig(
  signal?: AbortSignal,
): Promise<RuntimeConfig> {
  const r = await fetch("/config.json", { signal });
  if (!r.ok) throw new Error("无法读取地图配置");
  const config = (await r.json()) as RuntimeConfig;
  let display: {
    tiandituKey?: string | null;
    cesiumIonAccessToken?: string | null;
  } = { tiandituKey: null, cesiumIonAccessToken: null };
  try {
    const service = await sessionFetch("/api/display-config", {
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(2000)])
        : AbortSignal.timeout(2000),
    });
    if (service.ok) display = await service.json();
  } catch {
    // 在线凭据服务不可用时仍继续使用静态地图配置和本地椭球地形。
  }
  const runtime = {
    ...config,
    tiandituKey: display.tiandituKey ?? undefined,
    cesiumIonAccessToken: display.cesiumIonAccessToken ?? undefined,
  };
  if (config.basemap?.type !== "tianditu" || display.tiandituKey)
    return runtime;
  return {
    ...runtime,
    basemap: null,
    notice: "未配置天地图 Key · 当前使用本地低精度底图",
  };
}

export interface SessionUser {
  id: string;
  tenantId: string;
  role: "admin" | "editor" | "viewer";
  scenes: string[];
  kind: "account" | "demo";
  platformAdmin?: boolean;
}
export interface BusinessRevision {
  revision: number;
  data: import("@dtv/contracts").BusinessData;
  owner: { id: string; tenantId: string };
}
export async function mutation<T>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  // 写请求附加同源边界标识；服务端还会校验 Origin、会话、角色和修订号。
  const response = await (url.startsWith("/auth/") ? fetch : sessionFetch)(
    `/api${url}`,
    {
      method,
      credentials: "same-origin",
      headers: {
        "X-DTV-Request": "1",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "服务不可用" }));
    throw new Error(
      `${response.status === 409 ? "保存冲突：" : ""}${error.message ?? "请求失败"}`,
    );
  }
  return response.json();
}
export const authApi = {
  session: () =>
    get<{ user: SessionUser | null; demoEnabled: boolean }>("/auth/session"),
  demo: async () => {
    const result = await mutation<{ user: SessionUser }>("/auth/demo", "POST");
    activateSession();
    return result;
  },
  login: async (username: string, password: string) => {
    const result = await mutation<{ user: SessionUser }>(
      "/auth/login",
      "POST",
      { username, password },
    );
    activateSession();
    return result;
  },
  logout: async () => {
    const result = await mutation("/auth/logout", "POST");
    closeSession();
    return result;
  },
};
export const businessApi = {
  get: (scene: string, signal?: AbortSignal) =>
    get<BusinessRevision>(`/scenes/${scene}/business`, signal),
  put: (scene: string, state: BusinessRevision) =>
    mutation<BusinessRevision>(`/scenes/${scene}/business`, "PUT", state),
};
export const publicationApi = {
  list: (sceneId: string, signal?: AbortSignal) =>
    get<import("@dtv/contracts").BusinessPublication[]>(
      `/scenes/${sceneId}/publications`,
      signal,
    ),
  publish: (sceneId: string, revision: number, message: string) =>
    mutation<import("@dtv/contracts").BusinessPublication>(
      `/scenes/${sceneId}/publications`,
      "POST",
      { revision, message },
    ),
  rollback: (
    sceneId: string,
    targetRevision: number,
    expectedRevision: number,
  ) =>
    mutation<BusinessRevision>(
      `/scenes/${sceneId}/publications/rollback`,
      "POST",
      { targetRevision, expectedRevision },
    ),
  review: (
    sceneId: string,
    revision: number,
    decision: "approve" | "reject",
    message = "",
  ) =>
    mutation<import("@dtv/contracts").BusinessPublication>(
      `/scenes/${sceneId}/publications/${revision}/review`,
      "POST",
      { decision, message },
    ),
  activate: (sceneId: string, revision: number, trafficPercent = 100) =>
    mutation<import("@dtv/contracts").BusinessPublication>(
      `/scenes/${sceneId}/publications/${revision}/activate`,
      "POST",
      { trafficPercent },
    ),
};
export interface ManagedAccount {
  id: string;
  tenantId: string;
  role: SessionUser["role"];
  scenes: string[];
  disabled?: boolean;
}
export const accountAdminApi = {
  list: (signal?: AbortSignal) =>
    get<ManagedAccount[]>("/admin/accounts", signal),
  create: (body: {
    id: string;
    tenantId: string;
    role: ManagedAccount["role"];
    scenes: string[];
    password: string;
  }) => mutation<ManagedAccount>("/admin/accounts", "POST", body),
  update: (id: string, body: Omit<ManagedAccount, "id">) =>
    mutation<ManagedAccount>(
      `/admin/accounts/${encodeURIComponent(id)}`,
      "PUT",
      body,
    ),
  resetPassword: (id: string, password: string) =>
    mutation<{ ok: boolean }>(
      `/admin/accounts/${encodeURIComponent(id)}/password`,
      "PUT",
      { password },
    ),
};
export interface AuditEntry {
  id: string;
  tenantId: string;
  actor: string;
  sceneId: string;
  action: string;
  result: string;
  at: string;
}
export const auditApi = {
  list: (signal?: AbortSignal) => get<AuditEntry[]>("/audit", signal),
};

/** 场景配置与业务资料各自维护修订；发布只影响当前租户已授权地区。 */
export const scenarioApi = {
  read: (id: string, signal?: AbortSignal) =>
    get<import("@dtv/contracts").ScenarioRevision>(
      `/scenes/${encodeURIComponent(id)}/scenario-pack`,
      signal,
    ),
  save: (
    id: string,
    revision: number,
    pack: import("@dtv/contracts").ScenarioPack,
  ) =>
    mutation<import("@dtv/contracts").ScenarioRevision>(
      `/scenes/${encodeURIComponent(id)}/scenario-pack`,
      "PUT",
      { revision, pack },
    ),
  publish: (id: string, revision: number) =>
    mutation<import("@dtv/contracts").ScenarioRevision>(
      `/scenes/${encodeURIComponent(id)}/scenario-pack/publish`,
      "POST",
      { revision },
    ),
  restore: (id: string, revision: number, targetRevision: number) =>
    mutation<import("@dtv/contracts").ScenarioRevision>(
      `/scenes/${encodeURIComponent(id)}/scenario-pack/restore`,
      "POST",
      { revision, targetRevision },
    ),
};

export const authorizationApi = {
  current: (signal?: AbortSignal) =>
    get<import("@dtv/contracts").TenantEntitlement>("/authorization", signal),
  tenants: (signal?: AbortSignal) =>
    get<{ tenantId: string; accountCount: number }[]>("/admin/tenants", signal),
  tenant: (tenant: string) =>
    get<import("@dtv/contracts").TenantEntitlement>(
      `/admin/tenants/${encodeURIComponent(tenant)}/authorization`,
    ),
  import: (tenant: string, revision: number, certificate: unknown) =>
    mutation<import("@dtv/contracts").TenantEntitlement>(
      `/admin/tenants/${encodeURIComponent(tenant)}/authorization`,
      "PUT",
      { revision, certificate },
    ),
  revoke: (tenant: string, revision: number) =>
    mutation<import("@dtv/contracts").TenantEntitlement>(
      `/admin/tenants/${encodeURIComponent(tenant)}/authorization/revoke`,
      "POST",
      { revision },
    ),
};
