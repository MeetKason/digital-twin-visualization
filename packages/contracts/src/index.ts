import { z } from "zod";
export const SceneSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  regionCode: z.string(),
  center: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  height: z.number().positive(),
  modules: z.array(z.string()),
  revision: z.string(),
  source: z.literal("mock"),
});
export type SceneConfig = z.infer<typeof SceneSchema>;
export type LayerCategory = "weather" | "base" | "station";
export interface LayerDescriptor {
  id: string;
  name: string;
  category: LayerCategory;
  tag: string;
  datasetKey: string;
  rendererType: "station" | "grid" | "boundary" | "unavailable";
  opacitySupported: boolean;
  defaultOpacity: number;
  unit: string;
  available: boolean;
  reason?: string;
}
export interface WeatherObservation {
  source: "mock" | "tianqing" | "other";
  stationId: string;
  observedAt: string;
  ingestedAt: string;
  location: { lon: number; lat: number; crs: "EPSG:4326" };
  elements: {
    temperatureC: number | null;
    rainfallMm: number | null;
    windSpeedMs: number | null;
  };
  quality: Record<string, string>;
}
export interface Station {
  id: string;
  name: string;
  sceneId: string;
  lon: number;
  lat: number;
  elevationM: number;
  source: "mock";
  type: string;
}
export interface DataFrame {
  source: "mock";
  observedAt: string;
  unit: string;
  crs: "EPSG:4326";
  observations: WeatherObservation[];
}
export interface SearchResult {
  layers: LayerDescriptor[];
  stations: Station[];
  coordinate?: [number, number];
}
export const DEMO_DAY = "2026-11-07";
export const DEMO_TIMES = Array.from(
  { length: 13 },
  (_, i) => `${DEMO_DAY}T${String(i).padStart(2, "0")}:00:00+08:00`,
);
export const LAYERS: LayerDescriptor[] = [
  {
    id: "satellite",
    name: "卫星云图",
    category: "weather",
    tag: "卫星",
    rendererType: "unavailable",
    unit: "%",
    available: false,
    reason: "未接入授权卫星产品",
  },
  {
    id: "temperature",
    name: "气温实况",
    category: "weather",
    tag: "要素",
    rendererType: "grid",
    unit: "°C",
    available: true,
  },
  {
    id: "rainfall",
    name: "降水实况",
    category: "weather",
    tag: "要素",
    rendererType: "grid",
    unit: "mm / 1h",
    available: true,
  },
  {
    id: "radar",
    name: "雷达回波",
    category: "weather",
    tag: "雷达",
    rendererType: "unavailable",
    unit: "dBZ",
    available: false,
    reason: "未接入授权雷达产品",
  },
  {
    id: "wind",
    name: "风场实况",
    category: "weather",
    tag: "要素",
    rendererType: "unavailable",
    unit: "m/s",
    available: false,
    reason: "风场渲染器待接入",
  },
  {
    id: "humidity",
    name: "相对湿度",
    category: "weather",
    tag: "要素",
    rendererType: "unavailable",
    unit: "%",
    available: false,
    reason: "湿度数据待接入",
  },
  {
    id: "grid",
    name: "网格实况",
    category: "weather",
    tag: "网格",
    rendererType: "unavailable",
    unit: "",
    available: false,
    reason: "网格产品待接入",
  },
  {
    id: "forecast",
    name: "精细化预报",
    category: "weather",
    tag: "预报",
    rendererType: "unavailable",
    unit: "",
    available: false,
    reason: "预报产品待接入",
  },
  {
    id: "warning",
    name: "气象预警范围",
    category: "weather",
    tag: "预警",
    rendererType: "unavailable",
    unit: "",
    available: false,
    reason: "预警源待接入",
  },
  {
    id: "simulation",
    name: "自然环境模拟",
    category: "weather",
    tag: "模拟",
    rendererType: "unavailable",
    unit: "",
    available: false,
    reason: "后续阶段实现雨雪雾模拟",
  },
  {
    id: "boundary",
    name: "示例区域边界",
    category: "base",
    tag: "示例",
    rendererType: "boundary",
    unit: "",
    available: true,
  },
  {
    id: "stations",
    name: "气象观测站",
    category: "station",
    tag: "站点",
    rendererType: "station",
    unit: "°C",
    available: true,
  },
].map((x) => ({
  ...x,
  datasetKey: `dataset:${x.id}:v1`,
  opacitySupported: x.rendererType !== "unavailable",
  defaultOpacity: 0.8,
})) as LayerDescriptor[];
export function demoStations(scene: SceneConfig): Station[] {
  return [
    [-0.25, 0.16],
    [0, 0],
    [0.28, 0.12],
    [-0.1, -0.2],
    [0.42, -0.15],
    [0.14, 0.32],
  ].map(([dx, dy], i) => ({
    id: `${scene.id}-${57000 + i}`,
    name: `${scene.shortName}演示站 ${i + 1}`,
    sceneId: scene.id,
    lon: scene.center[0] + dx,
    lat: scene.center[1] + dy,
    elevationM: 400 + i * 38,
    source: "mock",
    type: "自动气象站",
  }));
}
export function demoObservations(
  scene: SceneConfig,
  time: string,
): WeatherObservation[] {
  const hour = new Date(time).getUTCHours();
  return demoStations(scene).map((s, i) => ({
    source: "mock",
    stationId: s.id,
    observedAt: time,
    ingestedAt: time,
    location: { lon: s.lon, lat: s.lat, crs: "EPSG:4326" },
    elements: {
      temperatureC: Number((15 + i * 1.6 + Math.sin(hour) * 2).toFixed(1)),
      rainfallMm: Number((((i + hour) % 7) * 0.8).toFixed(1)),
      windSpeedMs: 2 + i * 0.3,
    },
    quality: { temperatureC: "demo", rainfallMm: "demo" },
  }));
}
