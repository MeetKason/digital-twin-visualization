import { useEffect, useState } from "react";
import type { SceneConfig, Station } from "@dtv/contracts";
import { parseAdministrativeBoundary } from "./administrativeBoundary";

interface Props {
  scene: SceneConfig;
  stations: Station[];
}

interface PreviewGeometry {
  paths: string[];
  stations: Array<{ x: number; y: number; name: string }>;
}

/** 从本地行政区 GeoJSON 绘制轻量预览，不加载 Cesium、瓦片或地形资源。 */
export function MapLoadingPreview({ scene, stations }: Props) {
  const [geometry, setGeometry] = useState<PreviewGeometry>({
    paths: [],
    stations: [],
  });

  useEffect(() => {
    if (!scene.boundaryUrl) {
      setGeometry({ paths: [], stations: [] });
      return;
    }
    const controller = new AbortController();
    void fetch(scene.boundaryUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("行政边界读取失败");
        return response.json();
      })
      .then((data) => {
        const rings = parseAdministrativeBoundary(data).map((ring) => {
          const coordinates: Array<[number, number]> = [];
          for (let index = 0; index < ring.coordinates.length; index += 2)
            coordinates.push([
              ring.coordinates[index],
              ring.coordinates[index + 1],
            ]);
          return coordinates;
        });
        const positions = rings.flat();
        if (positions.length === 0) return;
        const bounds = positions.reduce(
          (value, [longitude, latitude]) => ({
            west: Math.min(value.west, longitude),
            east: Math.max(value.east, longitude),
            south: Math.min(value.south, latitude),
            north: Math.max(value.north, latitude),
          }),
          { west: 180, east: -180, south: 90, north: -90 },
        );
        const width = 1000;
        const height = 600;
        const padding = 70;
        const longitudeSpan = Math.max(bounds.east - bounds.west, 0.01);
        const latitudeSpan = Math.max(bounds.north - bounds.south, 0.01);
        const scale = Math.min(
          (width - padding * 2) / longitudeSpan,
          (height - padding * 2) / latitudeSpan,
        );
        const offsetX = (width - longitudeSpan * scale) / 2;
        const offsetY = (height - latitudeSpan * scale) / 2;
        const project = ([longitude, latitude]: [number, number]) => [
          offsetX + (longitude - bounds.west) * scale,
          height - offsetY - (latitude - bounds.south) * scale,
        ];
        const paths = rings.map((ring) =>
          ring
            .map((coordinate, index) => {
              const [x, y] = project(coordinate);
              return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ") + " Z",
        );
        const projectedStations = stations
          .filter(
            (station) =>
              station.lon >= bounds.west &&
              station.lon <= bounds.east &&
              station.lat >= bounds.south &&
              station.lat <= bounds.north,
          )
          .slice(0, 12)
          .map((station) => {
            const [x, y] = project([station.lon, station.lat]);
            return { x, y, name: station.name };
          });
        if (!controller.signal.aborted)
          setGeometry({ paths, stations: projectedStations });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setGeometry({ paths: [], stations: [] });
      });
    return () => controller.abort();
  }, [scene.boundaryUrl, stations]);

  return (
    <div className="map-loading-preview" role="status" aria-label="正在载入三维地图">
      <svg
        className="map-loading-preview__drawing"
        viewBox="0 0 1000 600"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="preview-ground" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#b3c6a3" />
            <stop offset="0.48" stopColor="#d0d1ad" />
            <stop offset="1" stopColor="#7e9e82" />
          </linearGradient>
          <radialGradient id="preview-valley">
            <stop offset="0" stopColor="#ede1bf" stopOpacity=".76" />
            <stop offset="1" stopColor="#c3c9a6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="1000" height="600" fill="url(#preview-ground)" />
        <ellipse cx="520" cy="300" rx="460" ry="250" fill="url(#preview-valley)" />
        <g className="map-loading-preview__contours" fill="none">
          <path d="M-80 150 C80 40 210 85 290 180 S470 280 630 150 880 30 1080 170" />
          <path d="M-80 220 C90 110 205 145 300 238 S490 335 650 220 870 115 1080 240" />
          <path d="M-70 390 C100 285 255 325 340 415 S525 510 690 390 900 295 1080 415" />
          <path d="M-80 480 C100 380 250 410 350 500 S540 585 710 480 900 390 1080 500" />
        </g>
        <g className="map-loading-preview__boundary">
          {geometry.paths.map((path, index) => (
            <path key={index} d={path} />
          ))}
        </g>
        <g className="map-loading-preview__stations">
          {geometry.stations.map((station, index) => (
            <circle key={`${station.name}-${index}`} cx={station.x} cy={station.y} r="5" />
          ))}
        </g>
      </svg>
      <div className="map-loading-preview__label">
        <span className="map-loading-preview__spinner" />
        <span>正在载入三维地图</span>
        <small>{scene.name} · 预览</small>
      </div>
    </div>
  );
}
