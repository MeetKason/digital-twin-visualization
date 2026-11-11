import type { WeatherGridCell } from "@dtv/contracts";

const radarStops = [
  [5, 75, 145, 224], [10, 34, 184, 213], [20, 38, 190, 67],
  [30, 244, 225, 53], [40, 249, 151, 32], [50, 238, 56, 44], [60, 180, 38, 157], [70, 234, 181, 241],
];

/** 色阶来自当前帧数值；低回波和低云量透明，图形不再按格点索引编造颜色。 */
export function weatherColor(value: number, product: "radar" | "satellite" | "forecast"): [number, number, number, number] {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  if (product === "forecast") {
    const normalized = Math.max(0, Math.min(1, (value + 20) / 65));
    const a = normalized < 0.5 ? [55, 112, 191] : [236, 226, 141];
    const b = normalized < 0.5 ? [236, 226, 141] : [221, 113, 71];
    const fraction = normalized < 0.5 ? normalized * 2 : (normalized - 0.5) * 2;
    return [0, 1, 2].map((index) => Math.round(a[index] + (b[index] - a[index]) * fraction)).concat(165) as [number, number, number, number];
  }
  if (product === "satellite") {
    const cloud = Math.max(0, Math.min(1, (value - 12) / 88));
    const brightness = Math.round(135 + cloud * 120);
    return [brightness, brightness, Math.min(255, brightness + 6), Math.round(cloud * cloud * 225)];
  }
  if (value < 5) return [0, 0, 0, 0];
  const upper = radarStops.findIndex((stop) => stop[0] >= value);
  const end = upper < 0 ? radarStops.at(-1)! : radarStops[upper];
  const start = radarStops[Math.max(0, upper - 1)] ?? end;
  const ratio = end[0] === start[0] ? 1 : Math.max(0, Math.min(1, (value - start[0]) / (end[0] - start[0])));
  return [1, 2, 3].map((index) => Math.round(start[index] + (end[index] - start[index]) * ratio)).concat(210) as [number, number, number, number];
}

/** 把规则经纬度格点双线性重采样为连续图像；任何插值邻点缺测时保留透明孔洞。 */
export function rasterizeWeather(cells: WeatherGridCell[], product: "radar" | "satellite" | "forecast", width = 512, height = 384) {
  const valid = cells.filter((cell) => Number.isFinite(cell.value) && cell.bounds.every(Number.isFinite) && cell.bounds[0] < cell.bounds[2] && cell.bounds[1] < cell.bounds[3]);
  if (!valid.length) return null;
  const bounds: [number, number, number, number] = [Math.min(...valid.map((c) => c.bounds[0])), Math.min(...valid.map((c) => c.bounds[1])), Math.max(...valid.map((c) => c.bounds[2])), Math.max(...valid.map((c) => c.bounds[3]))];
  const longitude = [...new Set(valid.map((c) => (c.bounds[0] + c.bounds[2]) / 2))].sort((a, b) => a - b);
  const latitude = [...new Set(valid.map((c) => (c.bounds[1] + c.bounds[3]) / 2))].sort((a, b) => a - b);
  // 通过相邻中心定位像素，限制查找范围，避免逐像素遍历全部格点。
  const grid = new Map(valid.map((cell) => [
    `${longitude.indexOf((cell.bounds[0] + cell.bounds[2]) / 2)}:${latitude.indexOf((cell.bounds[1] + cell.bounds[3]) / 2)}`, cell.value,
  ]));
  const axis = (positions: number[], value: number): [number, number, number] => {
    if (positions.length === 1 || value <= positions[0]) return [0, 0, 0];
    if (value >= positions.at(-1)!) return [positions.length - 1, positions.length - 1, 0];
    const high = positions.findIndex((position) => position >= value);
    return [high - 1, high, (value - positions[high - 1]) / (positions[high] - positions[high - 1])];
  };
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const [y0, y1, fy] = axis(latitude, bounds[3] - (row + 0.5) / height * (bounds[3] - bounds[1]));
    for (let column = 0; column < width; column++) {
      const [x0, x1, fx] = axis(longitude, bounds[0] + (column + 0.5) / width * (bounds[2] - bounds[0]));
      const samples = [grid.get(`${x0}:${y0}`), grid.get(`${x1}:${y0}`), grid.get(`${x0}:${y1}`), grid.get(`${x1}:${y1}`)];
      if (samples.some((value) => value === undefined)) continue;
      const [a, b, c, d] = samples as number[];
      const value = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      pixels.set(weatherColor(value, product), (row * width + column) * 4);
    }
  }
  return { pixels, bounds, width, height };
}

/** 风向为来向，箭头表示气流去向；缺少风向或静风不绘制误导性箭头。 */
export function windGlyphs(cells: WeatherGridCell[]) {
  return cells.flatMap((cell) => {
    if (cell.directionDeg == null || !Number.isFinite(cell.directionDeg) || !Number.isFinite(cell.value) || cell.value < 0.2) return [];
    const lon = (cell.bounds[0] + cell.bounds[2]) / 2, lat = (cell.bounds[1] + cell.bounds[3]) / 2;
    const angle = (cell.directionDeg + 180) * Math.PI / 180;
    const length = Math.min(0.06, 0.015 + cell.value * 0.002);
    return [{ id: cell.id, speed: cell.value, start: [lon, lat] as [number, number],
      end: [lon + Math.sin(angle) * length / Math.max(0.1, Math.cos(lat * Math.PI / 180)), lat + Math.cos(angle) * length] as [number, number] }];
  });
}
