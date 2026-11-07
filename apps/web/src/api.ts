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
  times: (id: string, signal?: AbortSignal) =>
    get<string[]>(`/layers/${id}/times`, signal),
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
