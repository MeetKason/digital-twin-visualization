import { Cartesian3, type Scene } from "cesium";
import type { WeatherGridCell } from "@dtv/contracts";
import { administrativeBounds, type AdministrativePolygons } from "./administrativeBoundary";

interface WindParticle {
  lon: number;
  lat: number;
  previous: Array<[number, number]>;
  speed: number;
}

interface WindVector {
  lon: number;
  lat: number;
  east: number;
  north: number;
  speed: number;
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
      previous: [],
      speed: 0,
    };
  };
  const particles = Array.from({ length: 420 }, makeParticle);
  let frame = 0;
  let previousTime = 0;
  let opacity = 0.9;
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

  const sampleWind = (lon: number, lat: number) => {
    let east = 0,
      north = 0,
      total = 0,
      speed = 0;
    for (const vector of vectors) {
      const dx = (vector.lon - lon) * Math.cos((lat * Math.PI) / 180);
      const dy = vector.lat - lat;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < 1e-9) return vector;
      const weight = 1 / Math.pow(distanceSquared, 1.15);
      east += vector.east * weight;
      north += vector.north * weight;
      speed += vector.speed * weight;
      total += weight;
    }
    return { east: east / total, north: north / total, speed: speed / total };
  };
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
    for (const particle of particles) {
      const wind = sampleWind(particle.lon, particle.lat);
      particle.speed = wind.speed;
      particle.previous.push([particle.lon, particle.lat]);
      if (particle.previous.length > 4) particle.previous.shift();
      // 加速呈现风流趋势；比例只影响视觉运动，不修改真实风速与图例。
      const distance = (wind.speed * elapsed * 180) / 111320;
      particle.lon +=
        ((wind.east / Math.max(0.1, wind.speed)) * distance) /
        Math.max(0.1, Math.cos((particle.lat * Math.PI) / 180));
      particle.lat += (wind.north / Math.max(0.1, wind.speed)) * distance;
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
      if (particle.previous.length < 2) continue;
      const positions = [
        particle.previous[0],
        [particle.lon, particle.lat] as [number, number],
      ];
      const projected = positions.map(([longitude, latitude]) => {
        const point = scene.cartesianToCanvasCoordinates(
          Cartesian3.fromDegrees(longitude, latitude, 40),
        );
        return point ? ([point.x, point.y] as [number, number]) : null;
      });
      const start = projected[0],
        end = projected[1];
      if (
        !start ||
        !end ||
        Math.abs(start[0] - end[0]) + Math.abs(start[1] - end[1]) > 80
      )
        continue;
      const hue = Math.max(0, Math.min(1, particle.speed / 25));
      const color =
        hue < 0.5
          ? `rgba(39, ${Math.round(191 + hue * 100)}, 235, ${0.48 + hue * 0.3})`
          : `rgba(255, ${Math.round(246 - (hue - 0.5) * 350)}, 82, ${0.63 + hue * 0.25})`;
      context.strokeStyle = color;
      context.lineWidth = 1 + hue * 1.3;
      context.beginPath();
      context.moveTo(start[0], start[1]);
      context.lineTo(end[0], end[1]);
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
