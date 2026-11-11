import type { SceneConfig } from "./scene";
export { SceneSchema, type SceneConfig } from "./scene";
export type LayerCategory = "weather" | "base" | "station";
export interface LayerDescriptor {
  id: string;
  name: string;
  category: LayerCategory;
  tag: string;
  datasetKey: string;
  /** 站点Provider选用的观测字段；未指定时显示temperatureC。 */
  valueField?: keyof WeatherObservation["elements"];
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
    radarDbz?: number | null;
    cloudPercent?: number | null;
    windFieldMs?: number | null;
    /** 气象风向：从正北顺时针计量的来向，单位度。 */
    windDirectionDeg?: number | null;
    relativeHumidity?: number | null;
    forecastTempC?: number | null;
    gridValue?: number | null;
    warningLevel?: number | null;
    simulationIntensity?: number | null;
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
export interface WeatherGridCell {
  id: string;
  bounds: [number, number, number, number];
  value: number;
  directionDeg?: number;
}
export interface DataFrame {
  storage?: "generated" | "ingested";
  source: "mock" | "tianqing" | "other";
  observedAt: string;
  unit: string;
  crs: "EPSG:4326";
  observations: WeatherObservation[];
  /** Mock 栅格图层使用的轻量格点；bounds 顺序为西、南、东、北。 */
  gridCells?: WeatherGridCell[];
  forecast?: { referenceTime: string; validTime: string; leadHours: number };
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
    tag: "卫星 · Mock",
    rendererType: "grid",
    unit: "%",
    available: true,
    reason: "仅显示可重复 Mock 云量格点，不代表卫星实况",
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
    tag: "雷达 · Mock",
    rendererType: "grid",
    unit: "dBZ",
    available: true,
    reason: "仅显示可重复 Mock 回波格点，不代表雷达实况",
  },
  {
    id: "wind",
    name: "风场实况",
    category: "weather",
    tag: "要素 · Mock",
    rendererType: "grid",
    unit: "m/s",
    available: true,
    reason: "确定性 Mock 风场，不代表实况",
  },
  {
    id: "humidity",
    name: "相对湿度",
    category: "weather",
    tag: "要素 · Mock",
    rendererType: "grid",
    unit: "%",
    available: true,
    reason: "确定性 Mock 湿度，不代表实况",
  },
  {
    id: "grid",
    name: "网格实况",
    category: "weather",
    tag: "网格 · Mock",
    rendererType: "grid",
    unit: "指数",
    available: true,
    reason: "确定性 Mock 综合格点，不代表正式网格产品",
  },
  {
    id: "forecast",
    name: "精细化预报",
    category: "weather",
    tag: "预报 · Mock",
    rendererType: "grid",
    unit: "°C",
    available: true,
    reason: "确定性 Mock 预报场，不代表业务预报",
  },
  {
    id: "warning",
    name: "气象预警范围",
    category: "weather",
    tag: "预警 · Mock",
    rendererType: "grid",
    unit: "等级",
    available: true,
    reason: "Mock 阈值范围，不是正式预警范围",
  },
  {
    id: "simulation",
    name: "自然环境模拟",
    category: "weather",
    tag: "模拟 · Mock",
    rendererType: "grid",
    unit: "%",
    available: true,
    reason: "确定性 Mock 环境模拟强度",
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
    name: "国家有人站",
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
const baseEntries = [
  "高清遥感影像",
  "航拍影像",
  "行政边界",
  "水系 / 河流",
  "道路",
  "地名标注",
  "地形阴影",
  "重点区域边界",
];
baseEntries.forEach((name, i) =>
  LAYERS.push({
    id: `base-${i}`,
    name,
    category: "base",
    tag: i === 2 ? "行政" : "底图",
    datasetKey: `dataset:base-${i}:v1`,
    rendererType: "unavailable",
    opacitySupported: false,
    defaultOpacity: 0.8,
    unit: "",
    available: false,
    reason: "未配置该内网地理数据源",
  }),
);
const stationEntries = [
  "国家无人站",
  "雷达站",
  "高空观测站",
  "土壤水分站",
  "人影高炮点",
  "人影火箭点",
  "灾害风险点",
  "视频点位",
  "收藏点位",
];
stationEntries.forEach((name, i) =>
  LAYERS.push({
    id: `station-${i}`,
    name,
    category: "station",
    tag: i === 6 ? "风险" : i === 7 ? "视频" : "站点",
    datasetKey: `dataset:station-${i}:v1`,
    rendererType: "station",
    opacitySupported: true,
    defaultOpacity: 0.8,
    unit: "°C",
    available: true,
  }),
);
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

export type MockGridProduct =
  | "radar-grid" | "satellite-cloud" | "wind-field" | "humidity-field"
  | "grid-analysis" | "forecast-hourly" | "warning-range" | "environment-simulation";

export const MOCK_LAYER_PRODUCTS: Record<string, MockGridProduct> = {
  radar: "radar-grid",
  satellite: "satellite-cloud",
  wind: "wind-field",
  humidity: "humidity-field",
  grid: "grid-analysis",
  forecast: "forecast-hourly",
  warning: "warning-range",
  simulation: "environment-simulation",
};

/** 生成稳定的演示格点，供真实气象产品接入前进行功能和界面验收。 */
export function demoProductGrid(
  scene: SceneConfig,
  time: string,
  product: MockGridProduct,
) {
  // 固定 10×8 网格并仅用时次、地区和格点位置计算值，使样例可重复验收。
  const hour = new Date(time).getUTCHours();
  const [centerLon, centerLat] = scene.center;
  const columns = 10;
  const rows = 8;
  const width = 1.16 / columns;
  const height = 0.88 / rows;
  const stormX = centerLon + Math.sin((hour + scene.regionCode.length) / 3) * 0.2;
  const stormY = centerLat + Math.cos((hour + 2) / 4) * 0.16;
  const cells: WeatherGridCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const west = centerLon - 0.58 + column * width;
      const south = centerLat - 0.44 + row * height;
      const lon = west + width / 2;
      const lat = south + height / 2;
      const distance = Math.hypot((lon - stormX) * Math.cos((centerLat * Math.PI) / 180), lat - stormY);
      const wave = Math.sin((row * 7 + column * 11 + hour * 3) / 5) * 0.5 + 0.5;
      const raw = product === "radar-grid"
        ? Math.max(0, Math.min(70, (1 - distance / 0.52) * 62 + wave * 12 - 8))
        : product === "satellite-cloud"
          ? Math.max(0, Math.min(100, 12 + (1 - distance / 0.72) * 72 + wave * 20))
          : product === "wind-field"
            ? 1.5 + wave * 13 + Math.abs(Math.sin(hour / 4)) * 3
            : product === "humidity-field"
              ? 24 + wave * 72
              : product === "grid-analysis"
                ? Math.max(0, (1 - distance / 0.7) * 58 + wave * 42)
                : product === "forecast-hourly"
                  ? 7 + row * 1.3 + Math.sin((hour + 8) / 4) * 7 + wave * 4
                  : product === "warning-range"
                    ? wave > 0.74 && distance < 0.5 ? 1 + Math.floor(wave * 4) : 0
                    : Math.max(0, Math.min(100, (1 - distance / 0.62) * 80 + wave * 24));
      const maximum = product === "radar-grid" ? 70 : product === "wind-field" ? 25 : product === "forecast-hourly" ? 45 : product === "warning-range" ? 4 : 100;
      cells.push({
        id: `${product}-${row}-${column}`,
        bounds: [west, south, west + width, south + height],
        value: Number(Math.max(0, Math.min(maximum, raw)).toFixed(1)),
        ...(product === "wind-field" ? { directionDeg: Math.round((Math.atan2(lon - stormX, lat - stormY) * 180 / Math.PI + 450 + hour * 3) % 360) } : {}),
      });
    }
  }
  return cells;
}

export function demoProductObservations(
  scene: SceneConfig,
  time: string,
  product: MockGridProduct,
): WeatherObservation[] {
  // 复用格点结果映射成通用观测结构，让 Mock 任务走与入库数据相同的接口。
  return demoProductGrid(scene, time, product).map((cell) => {
    const [west, south, east, north] = cell.bounds;
    return {
      source: "mock",
      stationId: cell.id,
      observedAt: time,
      ingestedAt: time,
      location: { lon: (west + east) / 2, lat: (south + north) / 2, crs: "EPSG:4326" },
      elements: {
        temperatureC: null,
        rainfallMm: null,
        windSpeedMs: null,
        radarDbz: product === "radar-grid" ? cell.value : null,
        cloudPercent: product === "satellite-cloud" ? cell.value : null,
        windFieldMs: product === "wind-field" ? cell.value : null,
        windDirectionDeg: product === "wind-field" ? cell.directionDeg : null,
        relativeHumidity: product === "humidity-field" ? cell.value : null,
        forecastTempC: product === "forecast-hourly" ? cell.value : null,
        gridValue: product === "grid-analysis" ? cell.value : null,
        warningLevel: product === "warning-range" ? cell.value : null,
        simulationIntensity: product === "environment-simulation" ? cell.value : null,
      },
      quality: { product: "deterministic-mock" },
    };
  });
}

export function productGridFromObservations(
  observations: WeatherObservation[],
  product: MockGridProduct,
) {
  const cellWidth = 1.16 / 10;
  const cellHeight = 0.88 / 8;
  const keys: Record<MockGridProduct, keyof WeatherObservation["elements"]> = {
    "radar-grid": "radarDbz", "satellite-cloud": "cloudPercent", "wind-field": "windFieldMs",
    "humidity-field": "relativeHumidity", "forecast-hourly": "forecastTempC", "grid-analysis": "gridValue",
    "warning-range": "warningLevel", "environment-simulation": "simulationIntensity",
  };
  return observations.flatMap((observation): WeatherGridCell[] => {
    const value = observation.elements[keys[product]];
    // 缺测不转换成0，否则无资料会伪装成晴空、静风或无预警。
    if (value == null || !Number.isFinite(value)) return [];
    const direction = observation.elements.windDirectionDeg;
    return [{
      id: observation.stationId,
      bounds: [observation.location.lon - cellWidth / 2, observation.location.lat - cellHeight / 2,
        observation.location.lon + cellWidth / 2, observation.location.lat + cellHeight / 2],
      value,
      ...(product === "wind-field" && direction != null && Number.isFinite(direction)
        ? { directionDeg: ((direction % 360) + 360) % 360 } : {}),
    }];
  });
}
export * from "./business";

export { validateModelFile, validateUpload } from "./files";
export * from "./ingestion";
export * from "./mock-weather";
export * from "./mock-devices";

/** 仅供Mock逐小时预报使用：以有效日期北京时间00时为起报，避免把预报当观测。 */
export function mockForecastMetadata(validTime: string) {
  const valid = Date.parse(validTime);
  if (!Number.isFinite(valid)) throw new Error("无效预报有效时间");
  const hour = 3600000;
  const reference = Math.floor((valid + 8 * hour) / (24 * hour)) * 24 * hour - 8 * hour;
  return { referenceTime: new Date(reference).toISOString(), validTime: new Date(valid).toISOString(), leadHours: (valid - reference) / hour };
}

export * from "./scenario";

/** 产品与展示图层共用一份对应关系，服务端查询和采集入口执行相同白名单。 */
export function layerForProduct(productId: string) {
  return productId === "surface-hourly" ? "temperature"
    : Object.entries(MOCK_LAYER_PRODUCTS).find(([, product]) => product === productId)?.[0];
}

export * from "./licensing";
