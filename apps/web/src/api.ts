import type {
  SceneConfig,
  LayerDescriptor,
  Station,
  SearchResult,
  DataFrame,
} from "@dtv/contracts";
async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${url}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "服务不可用" }));
    throw new Error(
      typeof body.message === "string" ? body.message : "请求失败",
    );
  }
  return response.json() as Promise<T>;
}
export const api = {
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
  basemap: null | {
    type: "xyz" | "wmts";
    url: string;
    layer?: string;
    style?: string;
    format?: string;
    tileMatrixSetID?: string;
  };
  terrainUrl: string | null;
  notice: string;
}
export async function runtimeConfig(): Promise<RuntimeConfig> {
  const r = await fetch("/config.json");
  if (!r.ok) throw new Error("无法读取地图配置");
  return r.json();
}

export interface SessionUser {
  id: string;
  tenantId: string;
  role: "admin" | "editor" | "viewer";
  scenes: string[];
  kind: "account" | "demo";
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
  const response = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: {
      "X-DTV-Request": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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
  demo: () => mutation<{ user: SessionUser }>("/auth/demo", "POST"),
  login: (username: string, password: string) =>
    mutation<{ user: SessionUser }>("/auth/login", "POST", {
      username,
      password,
    }),
  logout: () => mutation("/auth/logout", "POST"),
};
export const businessApi = {
  get: (scene: string, signal?: AbortSignal) =>
    get<BusinessRevision>(`/scenes/${scene}/business`, signal),
  put: (scene: string, state: BusinessRevision) =>
    mutation<BusinessRevision>(`/scenes/${scene}/business`, "PUT", state),
};
