import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  Color,
  Cartesian3,
  CustomDataSource,
  Rectangle,
  ConstantProperty,
  ColorMaterialProperty,
  Cartesian2,
  LabelStyle,
  VerticalOrigin,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Entity,
  UrlTemplateImageryProvider,
  WebMapTileServiceImageryProvider,
  CesiumTerrainProvider,
  EllipsoidTerrainProvider,
  TileMapServiceImageryProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { SceneConfig, Station, LayerDescriptor } from "@dtv/contracts";
import { LayerRuntime, type LayerHandle, type MapFacade } from "@dtv/sdk";
import { api, runtimeConfig } from "./api";
interface Props {
  scene: SceneConfig;
  stations: Station[];
  layers: LayerDescriptor[];
  time: string;
  onReady: (runtime: LayerRuntime, map: MapFacade) => void;
  onStation: (station: Station) => void;
}
export default function MapView({
  scene,
  stations,
  layers,
  time,
  onReady,
  onStation,
}: Props) {
  const container = useRef<HTMLDivElement>(null),
    currentTime = useRef(time),
    runtimeRef = useRef<LayerRuntime | null>(null);
  const [notice, setNotice] = useState("正在初始化本地地图…");
  const [error, setError] = useState("");
  currentTime.current = time;
  useEffect(() => {
    let disposed = false;
    let viewer: Viewer | undefined;
    let runtime: LayerRuntime | undefined;
    let handler: ScreenSpaceEventHandler | undefined;
    const initialize = async () => {
      try {
        const config = await runtimeConfig();
        if (disposed || !container.current) return;
        viewer = new Viewer(container.current, {
          baseLayer: false,
          baseLayerPicker: false,
          geocoder: false,
          animation: false,
          timeline: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          terrainProvider: new EllipsoidTerrainProvider(),
          skyBox: false,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
          contextOptions: { webgl: { alpha: false } },
        });
        const v = viewer;
        v.scene.globe.baseColor = Color.fromCssColorString("#d9e6dd");
        v.scene.backgroundColor = Color.fromCssColorString("#d9e5ed");
        v.scene.globe.enableLighting = false;
        const home = () =>
          v.camera.flyTo({
            destination: Cartesian3.fromDegrees(...scene.center, scene.height),
            duration: 0.7,
          });
        home();
        if (config.basemap) {
          const b = config.basemap;
          const provider =
            b.type === "wmts"
              ? new WebMapTileServiceImageryProvider({
                  url: b.url,
                  layer: b.layer ?? "",
                  style: b.style ?? "default",
                  format: b.format ?? "image/png",
                  tileMatrixSetID: b.tileMatrixSetID ?? "w",
                })
              : new UrlTemplateImageryProvider({ url: b.url });
          v.imageryLayers.addImageryProvider(provider);
          provider.errorEvent.addEventListener(() =>
            setError("内网底图加载失败，请检查服务与权限"),
          );
          setNotice("内网底图 · 气象叠加为 Mock 示例");
        } else {
          const provider = await TileMapServiceImageryProvider.fromUrl(
            "/cesium/Assets/Textures/NaturalEarthII",
          );
          if (disposed) return;
          v.imageryLayers.addImageryProvider(provider);
          setNotice("未配置内网天地图 · 本地低精度底图 / 示例数据");
        }
        if (config.terrainUrl) {
          const terrain = await CesiumTerrainProvider.fromUrl(
            config.terrainUrl,
          );
          if (disposed) return;
          v.terrainProvider = terrain;
        }
        const createLayer = async (
          id: string,
          signal: AbortSignal,
        ): Promise<LayerHandle> => {
          const descriptor = layers.find((l) => l.id === id);
          if (!descriptor) throw new Error("图层不存在");
          if (!descriptor.available)
            throw new Error(descriptor.reason ?? "未接入数据");
          const frame = await api.data(
            id,
            scene.id,
            currentTime.current,
            signal,
          );
          if (signal.aborted || disposed) throw new Error("加载已取消");
          const source = new CustomDataSource(id);
          const [lon, lat] = scene.center;
          const palette =
            id === "rainfall"
              ? ["#cee9ff", "#72c3eb", "#2e91d1", "#1864b0", "#25449b"]
              : ["#e4e7a0", "#d6d677", "#e4c569", "#e6a45c", "#d98359"];
          const values = frame.observations;
          if (id === "boundary") {
            source.entities.add({
              polyline: {
                positions: Cartesian3.fromDegreesArray([
                  lon - 0.55,
                  lat - 0.42,
                  lon + 0.62,
                  lat - 0.42,
                  lon + 0.62,
                  lat + 0.48,
                  lon - 0.55,
                  lat + 0.48,
                  lon - 0.55,
                  lat - 0.42,
                ]),
                width: 3,
                material: Color.fromCssColorString("#20b5da"),
              },
            });
            source.entities.add({
              position: Cartesian3.fromDegrees(lon + 0.42, lat + 0.45),
              label: {
                text: "示例范围 · 非行政边界",
                font: "14px sans-serif",
                fillColor: Color.fromCssColorString("#36586d"),
                showBackground: true,
                backgroundColor: Color.WHITE.withAlpha(0.85),
                pixelOffset: new Cartesian2(0, -12),
              },
            });
          } else if (id === "stations") {
            stations.forEach((s, i) =>
              source.entities.add({
                id: s.id,
                position: Cartesian3.fromDegrees(s.lon, s.lat, 40),
                point: {
                  pixelSize: 12,
                  color: Color.fromCssColorString("#1263c4"),
                  outlineColor: Color.WHITE,
                  outlineWidth: 3,
                  disableDepthTestDistance: Infinity,
                },
                label: {
                  text: `${s.name}\n${values[i]?.elements.temperatureC ?? "—"} °C`,
                  font: "13px sans-serif",
                  fillColor: Color.fromCssColorString("#243244"),
                  outlineColor: Color.WHITE,
                  outlineWidth: 3,
                  style: LabelStyle.FILL_AND_OUTLINE,
                  verticalOrigin: VerticalOrigin.BOTTOM,
                  pixelOffset: new Cartesian2(0, -15),
                  disableDepthTestDistance: Infinity,
                },
              }),
            );
          } else {
            for (let row = 0; row < 8; row++)
              for (let col = 0; col < 10; col++) {
                const x = lon - 0.55 + col * 0.117,
                  y = lat - 0.42 + row * 0.1125;
                const idx =
                  (row + col + new Date(frame.observedAt).getUTCHours() + 8) %
                  5;
                source.entities.add({
                  rectangle: {
                    coordinates: Rectangle.fromDegrees(
                      x,
                      y,
                      x + 0.115,
                      y + 0.111,
                    ),
                    material: Color.fromCssColorString(palette[idx]).withAlpha(
                      0.65,
                    ),
                    height: 5,
                  },
                });
              }
          }
          await v.dataSources.add(source);
          const baseColors = new Map<Entity, Color>();
          source.entities.values.forEach((e) => {
            const m = e.rectangle?.material;
            if (m instanceof ColorMaterialProperty)
              baseColors.set(
                e,
                m.color?.getValue(v.clock.currentTime) ?? Color.WHITE,
              );
          });
          v.scene.requestRender();
          return {
            setOpacity(value) {
              source.entities.values.forEach((e) => {
                const color = baseColors.get(e);
                if (color && e.rectangle)
                  e.rectangle.material = new ColorMaterialProperty(
                    color.withAlpha(value),
                  );
                if (e.point)
                  e.point.color = new ConstantProperty(
                    Color.fromCssColorString("#1263c4").withAlpha(value),
                  );
                if (e.label) {
                  e.label.fillColor = new ConstantProperty(
                    Color.fromCssColorString("#243244").withAlpha(value),
                  );
                  e.label.outlineColor = new ConstantProperty(
                    Color.WHITE.withAlpha(value),
                  );
                  e.label.backgroundColor = new ConstantProperty(
                    Color.WHITE.withAlpha(value * 0.85),
                  );
                }
                if (e.polyline)
                  e.polyline.material = new ColorMaterialProperty(
                    Color.fromCssColorString("#20b5da").withAlpha(value),
                  );
              });
              v.scene.requestRender();
            },
            async setTime(nextTime) {
              currentTime.current = nextTime;
              await runtime?.toggle(id, true);
            },
            dispose() {
              if (!v.isDestroyed()) {
                v.dataSources.remove(source, true);
                v.scene.requestRender();
              }
            },
          };
        };
        runtime = new LayerRuntime(createLayer);
        runtimeRef.current = runtime;
        const map: MapFacade = {
          flyTo: (lon, lat, height = scene.height * 0.65) =>
            v.camera.flyTo({
              destination: Cartesian3.fromDegrees(lon, lat, height),
              duration: 0.7,
            }),
          zoom: (factor) => {
            v.camera.zoomIn(
              v.camera.positionCartographic.height * (1 - factor),
            );
            v.scene.requestRender();
          },
          north: () => {
            v.camera.setView({
              orientation: { heading: 0, pitch: v.camera.pitch, roll: 0 },
            });
            v.scene.requestRender();
          },
          setMode: (mode) => {
            if (mode === "2d") v.scene.morphTo2D(0.5);
            else v.scene.morphTo3D(0.5);
          },
        };
        handler = new ScreenSpaceEventHandler(v.scene.canvas);
        handler.setInputAction((click: { position: Cartesian2 }) => {
          const pick = v.scene.pick(click.position);
          const station = stations.find((s) => s.id === pick?.id?.id);
          if (station) onStation(station);
        }, ScreenSpaceEventType.LEFT_CLICK);
        onReady(runtime, map);
        void runtime.toggle("boundary", true);
        void runtime.toggle("stations", true);
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "地图初始化失败");
      }
    };
    void initialize();
    return () => {
      disposed = true;
      runtime?.dispose();
      runtimeRef.current = null;
      handler?.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [scene, stations, layers, onReady, onStation]);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    for (const l of layers)
      if (["on", "loading"].includes(runtime.snapshot(l.id).status))
        void runtime.toggle(l.id, true);
  }, [time, layers]);
  return (
    <>
      <div ref={container} className="map-canvas" aria-label="三维交互地图" />
      <div className="map-notice">
        <span className="status-dot" />
        {notice}
      </div>
      {error && (
        <div role="alert" className="map-error">
          {error}
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )}
      <div className="map-coordinates">
        EPSG:4326 · {scene.center[0].toFixed(4)}°E，{scene.center[1].toFixed(4)}
        °N · 示例范围
      </div>
    </>
  );
}
