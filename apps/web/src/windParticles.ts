import { Cartesian3, type Scene } from "cesium";
import type { WeatherGridCell } from "@dtv/contracts";
import { administrativeBounds, type AdministrativePolygons } from "./administrativeBoundary";
import { windSpeedRgb } from "./weatherRendering";

interface WindParticle {
  lon: number;
  lat: number;
  speed: number;
}

interface WindVector {
  lon: number;
  lat: number;
  east: number;
  north: number;
  speed: number;
}

interface WindField {
  columns: number;
  rows: number;
  east: Float32Array;
  north: Float32Array;
  speed: Float32Array;
  bounds: [number, number, number, number];
}

/**
 * 在 Cesium 地图上叠加按风速着色的短箭头，沿气流去向移动。
 * 粒子只存在于当前图层生命周期中，关闭风场时会释放画布、监听器和动画帧。
 */
export function createWindParticleOverlay(
  host: HTMLElement,
  scene: Scene,
  cells: WeatherGridCell[],
  polygons?: AdministrativePolygons | null,
): { setOpacity: (opacity: number) => void; dispose: () => void } | null {
  const vectors: WindVector[] = cells.flatMap((cell) => {
    if (
      cell.directionDeg == null ||
      !Number.isFinite(cell.directionDeg) ||
      !Number.isFinite(cell.value) ||
      cell.value < 0.2
    )
      return [];
    const [west, south, east, north] = cell.bounds;
    const angle = ((cell.directionDeg + 180) * Math.PI) / 180;
    return [
      {
        lon: (west + east) / 2,
        lat: (south + north) / 2,
        east: Math.sin(angle) * cell.value,
        north: Math.cos(angle) * cell.value,
        speed: cell.value,
      },
    ];
  });
  if (!vectors.length) return null;

  const cellBounds: [number, number, number, number] = [
    Math.min(...cells.map((cell) => cell.bounds[0])),
    Math.min(...cells.map((cell) => cell.bounds[1])),
    Math.max(...cells.map((cell) => cell.bounds[2])),
    Math.max(...cells.map((cell) => cell.bounds[3])),
  ];
  const bounds = polygons?.length ? administrativeBounds(polygons) : cellBounds;
  const field = buildWindField(vectors, bounds);
  // 将复杂区划一次性栅格化为占用表；动画帧只查像素，不逐帧遍历区县边界顶点。
  const coverage = polygons?.length ? (() => {
    const mask = document.createElement("canvas");
    mask.width = 384;
    mask.height = 384;
    const ctx = mask.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    for (const rings of polygons) {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], index) => {
          const x = ((lon - bounds[0]) / (bounds[2] - bounds[0])) * mask.width;
          const y = ((bounds[3] - lat) / (bounds[3] - bounds[1])) * mask.height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill("evenodd");
    }
    const alpha = ctx.getImageData(0, 0, mask.width, mask.height).data;
    const filled: number[] = [];
    for (let pixel = 0; pixel < mask.width * mask.height; pixel++)
      if (alpha[pixel * 4 + 3] > 127) filled.push(pixel);
    return { alpha, filled, width: mask.width, height: mask.height };
  })() : null;
  const inside = (lon: number, lat: number) => {
    if (!coverage) return true;
    const x = Math.floor(((lon - bounds[0]) / (bounds[2] - bounds[0])) * coverage.width);
    const y = Math.floor(((bounds[3] - lat) / (bounds[3] - bounds[1])) * coverage.height);
    return x >= 0 && x < coverage.width && y >= 0 && y < coverage.height &&
      coverage.alpha[(y * coverage.width + x) * 4 + 3] > 127;
  };
  const canvas = document.createElement("canvas");
  canvas.className = "wind-particle-overlay";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.remove();
    return null;
  }
  const random = (() => {
    let seed = 725381;
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  })();
  const makeParticle = (): WindParticle => {
    const pixel = coverage?.filled.length
      ? coverage.filled[Math.floor(random() * coverage.filled.length)]
      : undefined;
    return {
      lon: pixel === undefined
        ? bounds[0] + random() * (bounds[2] - bounds[0])
        : bounds[0] + ((pixel % coverage!.width + 0.5) / coverage!.width) * (bounds[2] - bounds[0]),
      lat: pixel === undefined
        ? bounds[1] + random() * (bounds[3] - bounds[1])
        : bounds[3] - ((Math.floor(pixel / coverage!.width) + 0.5) / coverage!.height) * (bounds[3] - bounds[1]),
      speed: 0,
    };
  };
  const particleCount = () => {
    const rect = host.getBoundingClientRect();
    return Math.max(900, Math.min(2400, Math.round((rect.width * rect.height) / 520)));
  };
  let particles = Array.from({ length: particleCount() }, makeParticle);
  let frame = 0;
  let previousTime = 0;
  let disposed = false;

  const resize = () => {
    const rect = host.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const nextCount = particleCount();
    if (nextCount > particles.length)
      particles = particles.concat(Array.from({ length: nextCount - particles.length }, makeParticle));
    else if (nextCount < particles.length) particles = particles.slice(0, nextCount);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  const draw = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    if (now - previousTime < 32) return;
    const elapsed = previousTime
      ? Math.min((now - previousTime) / 1000, 0.08)
      : 0.032;
    previousTime = now;
    const rect = host.getBoundingClientRect();
    context.clearRect(0, 0, rect.width, rect.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const particle of particles) {
      const wind = sampleWindField(field, particle.lon, particle.lat);
      particle.speed = wind.speed;
      if (wind.speed < 0.2) {
        Object.assign(particle, makeParticle());
        continue;
      }
      const step = (wind.speed * elapsed * 120) / 111320;
      const east = wind.east / wind.speed;
      const north = wind.north / wind.speed;
      particle.lon += (east * step) / Math.max(0.2, Math.cos((particle.lat * Math.PI) / 180));
      particle.lat += north * step;
      if (
        particle.lon < bounds[0] ||
        particle.lon > bounds[2] ||
        particle.lat < bounds[1] ||
        particle.lat > bounds[3] ||
        !inside(particle.lon, particle.lat)
      ) {
        Object.assign(particle, makeParticle());
        continue;
      }
      const probe = 0.02;
      const aheadLon =
        particle.lon + (east * probe) / Math.max(0.2, Math.cos((particle.lat * Math.PI) / 180));
      const aheadLat = particle.lat + north * probe;
      const origin = project(scene, particle.lon, particle.lat);
      const ahead = project(scene, aheadLon, aheadLat);
      if (!origin || !ahead) continue;
      const screenX = ahead[0] - origin[0];
      const screenY = ahead[1] - origin[1];
      const screenLength = Math.hypot(screenX, screenY);
      if (screenLength < 0.4 || screenLength > 240) continue;
      const length = 14 + Math.min(16, wind.speed * 0.7);
      drawWindArrow(
        context,
        origin[0],
        origin[1],
        origin[0] + (screenX / screenLength) * length,
        origin[1] + (screenY / screenLength) * length,
        wind.speed,
      );
    }
    context.globalAlpha = 1;
    scene.requestRender();
  };
  frame = requestAnimationFrame(draw);

  return {
    setOpacity(value) {
      canvas.style.opacity = String(Math.max(0, Math.min(1, value)));
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    },
  };
}

/** 把格点风一次性插到规则网格，动画帧只做双线性取样。 */
function buildWindField(
  vectors: WindVector[],
  bounds: [number, number, number, number],
): WindField {
  const columns = 48;
  const rows = 36;
  const east = new Float32Array(columns * rows);
  const north = new Float32Array(columns * rows);
  const speed = new Float32Array(columns * rows);
  const latitudeScale = Math.cos((((bounds[1] + bounds[3]) / 2) * Math.PI) / 180);
  for (let row = 0; row < rows; row++) {
    const lat = bounds[3] - ((row + 0.5) / rows) * (bounds[3] - bounds[1]);
    for (let column = 0; column < columns; column++) {
      const lon = bounds[0] + ((column + 0.5) / columns) * (bounds[2] - bounds[0]);
      let eastSum = 0;
      let northSum = 0;
      let speedSum = 0;
      let weightSum = 0;
      for (const vector of vectors) {
        const dx = (vector.lon - lon) * latitudeScale;
        const dy = vector.lat - lat;
        const distanceSquared = dx * dx + dy * dy;
        const weight = distanceSquared < 1e-9 ? 1e9 : 1 / Math.pow(distanceSquared, 1.15);
        eastSum += vector.east * weight;
        northSum += vector.north * weight;
        speedSum += vector.speed * weight;
        weightSum += weight;
      }
      const index = row * columns + column;
      east[index] = eastSum / weightSum;
      north[index] = northSum / weightSum;
      speed[index] = speedSum / weightSum;
    }
  }
  return { columns, rows, east, north, speed, bounds };
}

/** 在预计算风场上双线性取样；越界点夹到网格边缘。 */
function sampleWindField(field: WindField, lon: number, lat: number) {
  const { bounds, columns, rows } = field;
  const x = ((lon - bounds[0]) / (bounds[2] - bounds[0])) * columns - 0.5;
  const y = ((bounds[3] - lat) / (bounds[3] - bounds[1])) * rows - 0.5;
  const x0 = Math.max(0, Math.min(columns - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(y)));
  const x1 = Math.min(columns - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const mix = (values: Float32Array) => {
    const a = values[y0 * columns + x0];
    const b = values[y0 * columns + x1];
    const c = values[y1 * columns + x0];
    const d = values[y1 * columns + x1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  return { east: mix(field.east), north: mix(field.north), speed: mix(field.speed) };
}

function project(scene: Scene, lon: number, lat: number): [number, number] | null {
  const point = scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(lon, lat, 40));
  return point ? [point.x, point.y] : null;
}

/** 绘制指向气流去向的短箭头，颜色只表示风速。 */
function drawWindArrow(
  context: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  speed: number,
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;
  const ux = dx / length;
  const uy = dy / length;
  const head = Math.min(7, length * 0.42);
  const [red, green, blue] = windSpeedRgb(speed);
  context.globalAlpha = 0.9;
  context.strokeStyle = `rgb(${red} ${green} ${blue})`;
  context.fillStyle = context.strokeStyle;
  context.lineWidth = 1.3 + Math.min(1.4, speed / 18);
  context.beginPath();
  context.moveTo(x0, y0);
  context.lineTo(x1 - ux * head * 0.55, y1 - uy * head * 0.55);
  context.stroke();
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x1 - ux * head + uy * head * 0.48, y1 - uy * head - ux * head * 0.48);
  context.lineTo(x1 - ux * head - uy * head * 0.48, y1 - uy * head + ux * head * 0.48);
  context.closePath();
  context.fill();
}
