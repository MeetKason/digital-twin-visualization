import type { DataFrame, WeatherGridCell } from "@dtv/contracts";

const radarStops = [
  [5, 75, 145, 224],
  [10, 34, 184, 213],
  [20, 38, 190, 67],
  [30, 244, 225, 53],
  [40, 249, 151, 32],
  [50, 238, 56, 44],
  [60, 180, 38, 157],
  [70, 234, 181, 241],
];

/** 色阶来自当前帧数值；低回波和低云量透明，图形不再按格点索引编造颜色。 */
export function weatherColor(
  value: number,
  product: "radar" | "satellite" | "forecast",
): [number, number, number, number] {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  if (product === "forecast") {
    const normalized = Math.max(0, Math.min(1, (value + 20) / 65));
    const a = normalized < 0.5 ? [55, 112, 191] : [236, 226, 141];
    const b = normalized < 0.5 ? [236, 226, 141] : [221, 113, 71];
    const fraction = normalized < 0.5 ? normalized * 2 : (normalized - 0.5) * 2;
    return [0, 1, 2]
      .map((index) => Math.round(a[index] + (b[index] - a[index]) * fraction))
      .concat(165) as [number, number, number, number];
  }
  if (product === "satellite") {
    const cloud = Math.max(0, Math.min(1, (value - 12) / 88));
    const brightness = Math.round(135 + cloud * 120);
    return [
      brightness,
      brightness,
      Math.min(255, brightness + 6),
      Math.round(cloud * cloud * 225),
    ];
  }
  if (value < 5) return [0, 0, 0, 0];
  const upper = radarStops.findIndex((stop) => stop[0] >= value);
  const end = upper < 0 ? radarStops.at(-1)! : radarStops[upper];
  const start = radarStops[Math.max(0, upper - 1)] ?? end;
  const ratio =
    end[0] === start[0]
      ? 1
      : Math.max(0, Math.min(1, (value - start[0]) / (end[0] - start[0])));
  return [1, 2, 3]
    .map((index) =>
      Math.round(start[index] + (end[index] - start[index]) * ratio),
    )
    .concat(210) as [number, number, number, number];
}

/** 把规则经纬度格点双线性重采样为连续图像；任何插值邻点缺测时保留透明孔洞。 */
export function rasterizeWeather(
  cells: WeatherGridCell[],
  product: "radar" | "satellite" | "forecast",
  width = 512,
  height = 384,
) {
  const valid = cells.filter(
    (cell) =>
      Number.isFinite(cell.value) &&
      cell.bounds.every(Number.isFinite) &&
      cell.bounds[0] < cell.bounds[2] &&
      cell.bounds[1] < cell.bounds[3],
  );
  if (!valid.length) return null;
  const bounds: [number, number, number, number] = [
    Math.min(...valid.map((c) => c.bounds[0])),
    Math.min(...valid.map((c) => c.bounds[1])),
    Math.max(...valid.map((c) => c.bounds[2])),
    Math.max(...valid.map((c) => c.bounds[3])),
  ];
  const longitude = [
    ...new Set(valid.map((c) => (c.bounds[0] + c.bounds[2]) / 2)),
  ].sort((a, b) => a - b);
  const latitude = [
    ...new Set(valid.map((c) => (c.bounds[1] + c.bounds[3]) / 2)),
  ].sort((a, b) => a - b);
  // 通过相邻中心定位像素，限制查找范围，避免逐像素遍历全部格点。
  const grid = new Map(
    valid.map((cell) => [
      `${longitude.indexOf((cell.bounds[0] + cell.bounds[2]) / 2)}:${latitude.indexOf((cell.bounds[1] + cell.bounds[3]) / 2)}`,
      cell.value,
    ]),
  );
  const axis = (
    positions: number[],
    value: number,
  ): [number, number, number] => {
    if (positions.length === 1 || value <= positions[0]) return [0, 0, 0];
    if (value >= positions.at(-1)!)
      return [positions.length - 1, positions.length - 1, 0];
    const high = positions.findIndex((position) => position >= value);
    return [
      high - 1,
      high,
      (value - positions[high - 1]) / (positions[high] - positions[high - 1]),
    ];
  };
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const [y0, y1, fy] = axis(
      latitude,
      bounds[3] - ((row + 0.5) / height) * (bounds[3] - bounds[1]),
    );
    for (let column = 0; column < width; column++) {
      const [x0, x1, fx] = axis(
        longitude,
        bounds[0] + ((column + 0.5) / width) * (bounds[2] - bounds[0]),
      );
      const samples = [
        grid.get(`${x0}:${y0}`),
        grid.get(`${x1}:${y0}`),
        grid.get(`${x0}:${y1}`),
        grid.get(`${x1}:${y1}`),
      ];
      if (samples.some((value) => value === undefined)) continue;
      const [a, b, c, d] = samples as number[];
      const value =
        (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      pixels.set(weatherColor(value, product), (row * width + column) * 4);
    }
  }
  return { pixels, bounds, width, height };
}

/** 将综合网格样本插值铺满行政区包围范围，随后由地图端按区划多边形裁去区外像素。 */
export function rasterizeGridAnalysis(
  cells: WeatherGridCell[],
  bounds: [number, number, number, number],
  palette: string[],
  width = 512,
  height = 384,
  valueRange = 100,
) {
  const samples = cells.flatMap((cell) => {
    const [west, south, east, north] = cell.bounds;
    if (
      !Number.isFinite(cell.value) ||
      !cell.bounds.every(Number.isFinite) ||
      west >= east ||
      south >= north
    )
      return [];
    return [{ lon: (west + east) / 2, lat: (south + north) / 2, value: cell.value }];
  });
  if (!samples.length || !palette.length || width < 1 || height < 1 || valueRange <= 0) return null;

  const colors = palette.map(parseHexColor);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const longitudeScale = Math.cos((((bounds[1] + bounds[3]) / 2) * Math.PI) / 180);
  for (let row = 0; row < height; row++) {
    const lat = bounds[3] - ((row + 0.5) / height) * (bounds[3] - bounds[1]);
    for (let column = 0; column < width; column++) {
      const lon = bounds[0] + ((column + 0.5) / width) * (bounds[2] - bounds[0]);
      let numerator = 0;
      let denominator = 0;
      let exact: number | undefined;
      for (const sample of samples) {
        const dx = (sample.lon - lon) * longitudeScale;
        const dy = sample.lat - lat;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1e-10) {
          exact = sample.value;
          break;
        }
        const weight = 1 / Math.pow(distanceSquared, 1.15);
        numerator += sample.value * weight;
        denominator += weight;
      }
      const value = Math.max(0, Math.min(valueRange, exact ?? numerator / denominator));
      const bucket = Math.min(colors.length - 1, Math.floor((value / valueRange) * colors.length));
      const alpha = 0.4 + Math.min(1, value / valueRange) * 0.42;
      const [red, green, blue] = colors[bucket];
      pixels.set([red, green, blue, Math.round(alpha * 255)], (row * width + column) * 4);
    }
  }
  return { pixels, bounds, width, height };
}

const temperatureStops: Array<[number, string]> = [
  [-40, "#3454a4"],
  [-20, "#3d9fef"],
  [0, "#c1f8fe"],
  [10, "#bfffb6"],
  [20, "#fdf4c5"],
  [28, "#fcb16e"],
  [35, "#fd5210"],
  [50, "#8b0000"],
];
const precipitationStops: Array<[number, string]> = [
  [0, "#dbf8d4"],
  [2.5, "#b7f5a9"],
  [5, "#72d872"],
  [10, "#43b641"],
  [25, "#60b9fe"],
  [50, "#0001fc"],
  [100, "#f107eb"],
  [250, "#8b0077"],
];
const humidityStops: Array<[number, string]> = [
  [0, "#f7fbff"],
  [20, "#deebf7"],
  [40, "#9ecae1"],
  [60, "#4292c6"],
  [80, "#08519c"],
  [100, "#08306b"],
];

function parseHexColor(hex: string): [number, number, number] {
  const value = hex.slice(1);
  return [0, 2, 4].map((index) =>
    Number.parseInt(value.slice(index, index + 2), 16),
  ) as [number, number, number];
}

function interpolateColor(
  value: number,
  stops: Array<[number, string]>,
  transparentAtZero = false,
): [number, number, number, number] {
  const matchingIndex = stops.findIndex(([threshold]) => threshold >= value);
  const upperIndex =
    matchingIndex < 0 ? stops.length - 1 : Math.max(1, matchingIndex);
  const upper = stops[upperIndex < 0 ? stops.length - 1 : upperIndex];
  const lower = stops[Math.max(0, upperIndex - 1)];
  const fraction = Math.max(
    0,
    Math.min(1, (value - lower[0]) / Math.max(0.001, upper[0] - lower[0])),
  );
  const a = parseHexColor(lower[1]),
    b = parseHexColor(upper[1]);
  return [0, 1, 2]
    .map((index) => Math.round(a[index] + (b[index] - a[index]) * fraction))
    .concat(transparentAtZero && value <= 0 ? 0 : 190) as [
    number,
    number,
    number,
    number,
  ];
}

/** 将站点观测或气象格点按参考项目的 IDW 思路插值成连续色面。 */
export function rasterizeObservationField(
  frame: DataFrame,
  field: "temperatureC" | "rainfallMm" | "relativeHumidity",
  bounds: [number, number, number, number],
  width = 512,
  height = 384,
) {
  const samples = frame.observations.flatMap((observation) => {
    const value = observation.elements[field];
    const { lon, lat } = observation.location;
    if (
      value == null ||
      !Number.isFinite(value) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat)
    )
      return [];
    if (field === "rainfallMm" && value < 0) return [];
    return [{ lon, lat, value }];
  });
  if (samples.length === 0 && field === "relativeHumidity") {
    for (const cell of frame.gridCells ?? []) {
      const lon = (cell.bounds[0] + cell.bounds[2]) / 2;
      const lat = (cell.bounds[1] + cell.bounds[3]) / 2;
      if (Number.isFinite(cell.value) && cell.value >= 0 && cell.value <= 100)
        samples.push({ lon, lat, value: cell.value });
    }
  }
  if (samples.length < 3) return null;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const centerLatitude = (bounds[1] + bounds[3]) / 2;
  const longitudeScale = Math.cos((centerLatitude * Math.PI) / 180);
  const stops =
    field === "temperatureC"
      ? temperatureStops
      : field === "rainfallMm"
        ? precipitationStops
        : humidityStops;
  for (let row = 0; row < height; row++) {
    const lat = bounds[3] - ((row + 0.5) / height) * (bounds[3] - bounds[1]);
    for (let column = 0; column < width; column++) {
      const lon =
        bounds[0] + ((column + 0.5) / width) * (bounds[2] - bounds[0]);
      let numerator = 0,
        denominator = 0,
        exact: number | undefined;
      for (const sample of samples) {
        const dx = (sample.lon - lon) * longitudeScale,
          dy = sample.lat - lat;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1e-10) {
          exact = sample.value;
          break;
        }
        const weight = 1 / Math.pow(distanceSquared, 1.15);
        numerator += sample.value * weight;
        denominator += weight;
      }
      const value = exact ?? numerator / denominator;
      const color = interpolateColor(value, stops, field === "rainfallMm");
      pixels.set(color, (row * width + column) * 4);
    }
  }
  return { pixels, bounds, width, height };
}

/** 风速色标与图例一致：低风速青，中风速黄，30 m/s 及以上为红。 */
export const windSpeedStops: Array<[number, string]> = [
  [0, "#1878a4"],
  [2, "#1aa8c4"],
  [4, "#2ec8a4"],
  [6, "#6ed24a"],
  [8, "#b6dc3c"],
  [10, "#e6dc3a"],
  [12, "#f0d030"],
  [14, "#f4b42c"],
  [16, "#f59228"],
  [18, "#f07024"],
  [20, "#e85428"],
  [22, "#e03828"],
  [24, "#d02424"],
  [26, "#c01820"],
  [28, "#a8141c"],
  [30, "#8c1018"],
];

/** 将风速映射到色标；超出 0–30 的值停在两端，不另造颜色。 */
export function windSpeedRgb(speed: number): [number, number, number] {
  const value = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const matching = windSpeedStops.findIndex(([stop]) => stop >= value);
  const upperIndex =
    matching < 0 ? windSpeedStops.length - 1 : Math.max(1, matching);
  const upper = windSpeedStops[upperIndex];
  const lower = windSpeedStops[upperIndex - 1];
  const fraction = Math.max(
    0,
    Math.min(1, (Math.min(value, 30) - lower[0]) / Math.max(0.001, upper[0] - lower[0])),
  );
  const start = parseHexColor(lower[1]);
  const end = parseHexColor(upper[1]);
  return [0, 1, 2].map((index) =>
    Math.round(start[index] + (end[index] - start[index]) * fraction),
  ) as [number, number, number];
}

/** 风场方向转为气流去向，供图例或低性能模式展示方向箭头。 */
export function windGlyphs(cells: WeatherGridCell[]) {
  return cells.flatMap((cell) => {
    if (
      cell.directionDeg == null ||
      !Number.isFinite(cell.directionDeg) ||
      !Number.isFinite(cell.value) ||
      cell.value < 0.2
    )
      return [];
    const lon = (cell.bounds[0] + cell.bounds[2]) / 2;
    const lat = (cell.bounds[1] + cell.bounds[3]) / 2;
    const angle = ((cell.directionDeg + 180) * Math.PI) / 180;
    const length = Math.min(0.06, 0.015 + cell.value * 0.002);
    return [
      {
        id: cell.id,
        speed: cell.value,
        start: [lon, lat] as [number, number],
        end: [
          lon +
            (Math.sin(angle) * length) /
              Math.max(0.1, Math.cos((lat * Math.PI) / 180)),
          lat + Math.cos(angle) * length,
        ] as [number, number],
      },
    ];
  });
}
