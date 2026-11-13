import {
  Cartesian3,
  Color,
  CustomDataSource,
  HeightReference,
  Math as CesiumMath,
  type Viewer,
} from "cesium";
import { createLatticeFlow, demoFlowFootprints, sampleLattice } from "./flowLattice";
import { windSpeedRgb } from "./weatherRendering";

const INLET_MPS = 8;
const BOX_HALF_METERS = 700;

/**
 * Run the street-level lattice inside a map box and draw white building masses
 * plus speed-colored particles. The buildings are illustrative 白膜, not surveyed models.
 */
export function createFlowDemo(
  viewer: Viewer,
  host: HTMLElement,
  center: [number, number],
): { dispose: () => void } {
  const [centerLon, centerLat] = center;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((centerLat * Math.PI) / 180);
  const halfLat = BOX_HALF_METERS / metersPerDegreeLat;
  const halfLon = BOX_HALF_METERS / metersPerDegreeLon;
  const west = centerLon - halfLon;
  const south = centerLat - halfLat;
  const east = centerLon + halfLon;
  const north = centerLat + halfLat;
  const solver = createLatticeFlow(96, 96);
  for (let index = 0; index < 40; index++) solver.step();

  const buildings = new CustomDataSource("flow-demo");
  const ring = [west, south, east, south, east, north, west, north, west, south];
  buildings.entities.add({
    polyline: {
      positions: Cartesian3.fromDegreesArray(ring),
      clampToGround: true,
      width: 2,
      material: Color.fromCssColorString("#7ec8e3"),
    },
  });
  for (const block of demoFlowFootprints) {
    const lon0 = west + block.x0 * (east - west);
    const lon1 = west + block.x1 * (east - west);
    const lat0 = south + block.y0 * (north - south);
    const lat1 = south + block.y1 * (north - south);
    buildings.entities.add({
      polygon: {
        hierarchy: Cartesian3.fromDegreesArray([lon0, lat0, lon1, lat0, lon1, lat1, lon0, lat1]),
        height: 0,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        extrudedHeight: block.heightM,
        extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
        material: Color.fromCssColorString("#f7f9fc").withAlpha(0.94),
        outline: true,
        outlineColor: Color.fromCssColorString("#9aafc2"),
        closeTop: true,
        closeBottom: true,
      },
    });
  }
  let removed = false;
  const added = viewer.dataSources.add(buildings);
  void Promise.resolve(added).then(() => {
    if (removed && !viewer.isDestroyed()) viewer.dataSources.remove(buildings, true);
  });

  const canvas = document.createElement("canvas");
  canvas.className = "wind-particle-overlay flow-demo-overlay";
  canvas.setAttribute("aria-hidden", "true");
  host.append(canvas);
  const context = canvas.getContext("2d");
  const random = (() => {
    let seed = 90210;
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  })();
  const spawn = (inlet = false) => {
    for (let attempt = 0; attempt < 16; attempt++) {
      const x = inlet ? 0.03 + random() * 0.06 : 0.04 + random() * 0.9;
      const y = 0.08 + random() * 0.84;
      if (!sampleLattice(solver.flow, x, y).solid) return { x, y };
    }
    return { x: 0.05, y: 0.5 };
  };
  const particles = Array.from({ length: 1100 }, () => spawn(false));
  let frame = 0;
  let disposed = false;

  const resize = () => {
    if (!context) return;
    const rect = host.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const draw = () => {
    if (disposed) return;
    frame = requestAnimationFrame(draw);
    if (!context || viewer.isDestroyed()) return;
    solver.step();
    const rect = host.getBoundingClientRect();
    context.clearRect(0, 0, rect.width, rect.height);
    context.lineCap = "round";
    for (const particle of particles) {
      const wind = sampleLattice(solver.flow, particle.x, particle.y);
      particle.x += wind.ux * 0.16;
      particle.y += wind.uy * 0.16;
      const outside =
        particle.x < 0.01 || particle.x > 0.98 || particle.y < 0.02 || particle.y > 0.98 || wind.solid;
      if (outside) {
        Object.assign(particle, spawn(true));
        continue;
      }
      const lon = west + particle.x * (east - west);
      const lat = south + particle.y * (north - south);
      const origin = viewer.scene.cartesianToCanvasCoordinates(Cartesian3.fromDegrees(lon, lat, 36));
      if (!origin || origin.x < -20 || origin.y < -20 || origin.x > rect.width + 20 || origin.y > rect.height + 20) continue;
      const magnitude = Math.hypot(wind.ux, wind.uy) || 1;
      const aheadLon = west + Math.min(0.99, particle.x + (wind.ux / magnitude) * 0.045) * (east - west);
      const aheadLat = south + Math.min(0.99, particle.y + (wind.uy / magnitude) * 0.045) * (north - south);
      const destination = viewer.scene.cartesianToCanvasCoordinates(
        Cartesian3.fromDegrees(aheadLon, aheadLat, 36),
      );
      if (!destination) continue;
      const dx = destination.x - origin.x;
      const dy = destination.y - origin.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.4) continue;
      const scale = 18;
      const metersPerSecond = (wind.speed / solver.flow.inlet) * INLET_MPS;
      const [red, green, blue] = windSpeedRgb(metersPerSecond);
      const tipX = origin.x + (dx / length) * scale;
      const tipY = origin.y + (dy / length) * scale;
      context.globalAlpha = 0.95;
      context.beginPath();
      context.moveTo(origin.x, origin.y);
      context.lineTo(tipX, tipY);
      context.lineWidth = 3.4;
      context.strokeStyle = "rgba(12, 28, 42, 0.55)";
      context.stroke();
      context.beginPath();
      context.moveTo(origin.x, origin.y);
      context.lineTo(tipX, tipY);
      context.lineWidth = 1.8;
      context.strokeStyle = `rgb(${red} ${green} ${blue})`;
      context.stroke();
    }
    context.globalAlpha = 1;
    viewer.scene.requestRender();
  };
  frame = requestAnimationFrame(draw);
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(centerLon - halfLon * 0.15, centerLat - halfLat * 0.85, 620),
    orientation: { heading: CesiumMath.toRadians(12), pitch: CesiumMath.toRadians(-32), roll: 0 },
    duration: 1.1,
  });

  return {
    dispose() {
      disposed = true;
      removed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.remove();
      if (!viewer.isDestroyed()) {
        viewer.dataSources.remove(buildings, true);
        viewer.scene.requestRender();
      }
    },
  };
}
