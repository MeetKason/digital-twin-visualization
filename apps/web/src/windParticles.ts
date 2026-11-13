import { Cartesian3, type Scene } from "cesium";
import type { WeatherGridCell } from "@dtv/contracts";
import { administrativeBounds, type AdministrativePolygons } from "./administrativeBoundary";

interface WindParticle {
  lon: number;
  lat: number;
  previous: Array<[number, number]>;
  speed: number;
  age: number;
}

interface WindVector {
  lon: number;
  lat: number;
  east: number;
  north: number;
  speed: number;
}

interface WindFieldGrid {
  east: Float32Array;
  north: Float32Array;
  speed: Float32Array;
  width: number;
  height: number;
  bounds: [number, number, number, number];
}

/** 参考实况风流场图的基础粒子数：短细密布，铺满区划。 */
export const WIND_PARTICLE_BASE_COUNT = 3600;
/** 历史点仅用于短段位移；视觉拖尾靠画布淡出叠成流线。 */
export const WIND_PARTICLE_TRAIL_LENGTH = 2;

/**
 * 按可视面积与区划覆盖比例缩放粒子数，使密度接近参考风流场图。
 */
export function windParticleCount(coverageRatio = 1, pixelArea = 1280 * 720): number {
  const areaScale = Math.max(0.7, Math.min(1.4, Math.sqrt(Math.max(1, pixelArea) / (1280 * 720))));
  const fillScale = 0.75 + Math.max(0.2, Math.min(1, coverageRatio)) * 0.5;
  return Math.round(WIND_PARTICLE_BASE_COUNT * areaScale * fillScale);
}

/**
 * 风速映射描边色与线宽：青 <6 · 黄 6–12 · 橙红 ≥12，对齐产品图例。
 */
export function windParticleStroke(speedMs: number): { color: string; lineWidth: number } {
  const t = Math.max(0, Math.min(1, speedMs / 25));
  const alpha = 0.55 + t * 0.4;
  if (t < 0.24) {
    const mix = t / 0.24;
    return {
      color: `rgba(${Math.round(45 + mix * 50)}, ${Math.round(190 + mix * 35)}, ${Math.round(245 - mix * 55)}, ${alpha})`,
      lineWidth: 0.9,
    };
  }
  if (t < 0.48) {
    const mix = (t - 0.24) / 0.24;
    return {
      color: `rgba(${Math.round(95 + mix * 160)}, ${Math.round(225 - mix * 25)}, ${Math.round(190 - mix * 120)}, ${alpha})`,
      lineWidth: 1,
    };
  }
  const mix = (t - 0.48) / 0.52;
  return {
    color: `rgba(255, ${Math.round(185 - mix * 125)}, ${Math.round(70 - mix * 35)}, ${alpha})`,
    lineWidth: 1.05 + mix * 0.4,
  };
}

/**
 * 将稀疏风向格点预采样为规则风场网格，动画帧只做双线性插值。
 */
export function buildWindFieldGrid(
  vectors: WindVector[],
  bounds: [number, number, number, number],
  width = 96,
  height = 96,
): WindFieldGrid {
  const east = new Float32Array(width * height);
  const north = new Float32Array(width * height);
  const speed = new Float32Array(width * height);
  const lonSpan = bounds[2] - bounds[0];
  const latSpan = bounds[3] - bounds[1];
  for (let row = 0; row < height; row++) {
    const lat = bounds[1] + ((row + 0.5) / height) * latSpan;
    const cosLat = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    for (let column = 0; column < width; column++) {
      const lon = bounds[0] + ((column + 0.5) / width) * lonSpan;
      let sumEast = 0;
      let sumNorth = 0;
      let sumSpeed = 0;
      let total = 0;
      let exact: WindVector | undefined;
      for (const vector of vectors) {
        const dx = (vector.lon - lon) * cosLat;
        const dy = vector.lat - lat;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1e-9) {
          exact = vector;
          break;
        }
        const weight = 1 / Math.pow(distanceSquared, 1.15);
        sumEast += vector.east * weight;
        sumNorth += vector.north * weight;
        sumSpeed += vector.speed * weight;
        total += weight;
      }
      const index = row * width + column;
      if (exact) {
        east[index] = exact.east;
        north[index] = exact.north;
        speed[index] = exact.speed;
      } else if (total > 0) {
        east[index] = sumEast / total;
        north[index] = sumNorth / total;
        speed[index] = sumSpeed / total;
      }
    }
  }
  return { east, north, speed, width, height, bounds };
}

/**
 * 从预采样风场双线性读取局地风速风向。
 */
export function sampleWindField(field: WindFieldGrid, lon: number, lat: number) {
  const { bounds, width, height, east, north, speed } = field;
  const fx = ((lon - bounds[0]) / Math.max(1e-9, bounds[2] - bounds[0])) * (width - 1);
  const fy = ((lat - bounds[1]) / Math.max(1e-9, bounds[3] - bounds[1])) * (height - 1);
  const x0 = Math.max(0, Math.min(width - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(height - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const i00 = y0 * width + x0;
  const i10 = i00 + 1;
  const i01 = i00 + width;
  const i11 = i01 + 1;
  const blend = (a: number, b: number, c: number, d: number) =>
    a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  return {
    east: blend(east[i00], east[i10], east[i01], east[i11]),
    north: blend(north[i00], north[i10], north[i01], north[i11]),
    speed: blend(speed[i00], speed[i10], speed[i01], speed[i11]),
  };
}

/**
 * 在 Cesium 地图上叠加轻量风粒子动画，表现沿风向流动的风场流线。
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
  // 将复杂区划一次性栅格化为占用表；动画帧只查像素，不逐帧遍历区县边界顶点。
  const coverage = polygons?.length
    ? (() => {
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
      })()
    : null;
  const inside = (lon: number, lat: number) => {
    if (!coverage) return true;
    const x = Math.floor(((lon - bounds[0]) / (bounds[2] - bounds[0])) * coverage.width);
    const y = Math.floor(((bounds[3] - lat) / (bounds[3] - bounds[1])) * coverage.height);
    return (
      x >= 0 &&
      x < coverage.width &&
      y >= 0 &&
      y < coverage.height &&
      coverage.alpha[(y * coverage.width + x) * 4 + 3] > 127
    );
  };
  const canvas = document.createElement("canvas");
  canvas.className = "wind-particle-overlay";
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-particle-count", "0");
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
      lon:
        pixel === undefined
          ? bounds[0] + random() * (bounds[2] - bounds[0])
          : bounds[0] +
            ((pixel % coverage!.width + 0.5) / coverage!.width) * (bounds[2] - bounds[0]),
      lat:
        pixel === undefined
          ? bounds[1] + random() * (bounds[3] - bounds[1])
          : bounds[3] -
            ((Math.floor(pixel / coverage!.width) + 0.5) / coverage!.height) *
              (bounds[3] - bounds[1]),
      previous: [],
      speed: 0,
      age: Math.floor(random() * 40),
    };
  };
  const coverageRatio = coverage?.filled.length
    ? coverage.filled.length / (coverage.width * coverage.height)
    : 1;
  const hostRect = host.getBoundingClientRect();
  const particleTotal = windParticleCount(
    coverageRatio,
    Math.max(1, hostRect.width) * Math.max(1, hostRect.height),
  );
  const particles = Array.from({ length: particleTotal }, makeParticle);
  canvas.setAttribute("data-particle-count", String(particles.length));
  const windField = buildWindFieldGrid(vectors, bounds);
  let frame = 0;
  let previousTime = 0;
  let opacity = 0.95;
  let disposed = false;

  const resize = () => {
    const rect = host.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  const draw = (now: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    if (now - previousTime < 28) return;
    const elapsed = previousTime ? Math.min((now - previousTime) / 1000, 0.08) : 0.032;
    previousTime = now;
    const rect = host.getBoundingClientRect();
    // 半透明淡出拖尾，让短粒子叠成连续流线纹理，接近参考风流场密度。
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "rgba(0,0,0,0.18)";
    context.fillRect(0, 0, rect.width, rect.height);
    context.globalCompositeOperation = "source-over";
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const particle of particles) {
      const wind = sampleWindField(windField, particle.lon, particle.lat);
      particle.speed = wind.speed;
      particle.age += 1;
      particle.previous.push([particle.lon, particle.lat]);
      if (particle.previous.length > WIND_PARTICLE_TRAIL_LENGTH) particle.previous.shift();
      // 加速呈现风流趋势；比例只影响视觉运动，不修改真实风速与图例。
      const distance = (Math.max(0.35, wind.speed) * elapsed * 165) / 111320;
      const magnitude = Math.max(0.1, wind.speed);
      particle.lon +=
        ((wind.east / magnitude) * distance) /
        Math.max(0.1, Math.cos((particle.lat * Math.PI) / 180));
      particle.lat += (wind.north / magnitude) * distance;
      if (
        particle.age > 90 ||
        particle.lon < bounds[0] ||
        particle.lon > bounds[2] ||
        particle.lat < bounds[1] ||
        particle.lat > bounds[3] ||
        !inside(particle.lon, particle.lat)
      ) {
        Object.assign(particle, makeParticle());
        continue;
      }
      if (particle.previous.length < 2) continue;
      const startPoint = scene.cartesianToCanvasCoordinates(
        Cartesian3.fromDegrees(particle.previous[0][0], particle.previous[0][1], 40),
      );
      const endPoint = scene.cartesianToCanvasCoordinates(
        Cartesian3.fromDegrees(particle.lon, particle.lat, 40),
      );
      if (
        !startPoint ||
        !endPoint ||
        Math.abs(startPoint.x - endPoint.x) + Math.abs(startPoint.y - endPoint.y) > 64
      )
        continue;
      const stroke = windParticleStroke(particle.speed);
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.lineWidth;
      context.beginPath();
      context.moveTo(startPoint.x, startPoint.y);
      context.lineTo(endPoint.x, endPoint.y);
      context.stroke();
    }
    scene.requestRender();
  };
  frame = requestAnimationFrame(draw);

  return {
    setOpacity(value) {
      opacity = Math.max(0, Math.min(1, value));
      canvas.style.opacity = String(opacity);
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
