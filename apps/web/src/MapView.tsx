import { rasterizeWeather, windGlyphs } from "./weatherRendering";
import { ImageryRecovery } from "./imageryRecovery";
import { UiButton } from "./ui/controls";
import { useEffect, useRef, useState } from "react";
import { Alert } from "antd";
import {
  Viewer,
  Ion,
  createWorldTerrainAsync,
  HeightReference,
  TileProviderError,
  Cartographic,
  Math as CesiumMath,
  HeadingPitchRange,
  Matrix4,
  PolygonHierarchy,
  Transforms,
  HeadingPitchRoll,
  Color,
  Cartesian3,
  CustomDataSource,
  Rectangle,
  ConstantProperty,
  ColorMaterialProperty,
  ImageMaterialProperty,
  PolylineArrowMaterialProperty,
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
  type TerrainProvider,
  TileMapServiceImageryProvider,
  Credit,
  CreditDisplay,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type {
  SceneConfig,
  Station,
  LayerDescriptor,
  DataFrame,
} from "@dtv/contracts";
import { LayerRuntime, type LayerHandle, type MapFacade } from "@dtv/sdk";
import { api, runtimeConfig } from "./api";
import { distanceMeters, areaMeters, type Coordinate } from "@dtv/contracts";
import { parseAdministrativeBoundary } from "./administrativeBoundary";
import { createTiandituProvider } from "./tianditu";
import { createTiandituTerrainProvider } from "./tiandituTerrain";
import { createStationMarker } from "./stationIcons";
interface Props {
  scene: SceneConfig;
  stations: Station[];
  layers: LayerDescriptor[];
  time: string;
  dataRevision?: number;
  onReady: (runtime: LayerRuntime, map: MapFacade) => void;
  onStation: (station: Station) => void;
  resolvePluginFrame?: (
    id: string,
    time: string,
    signal: AbortSignal,
  ) => Promise<DataFrame | null>;
  onFrame?: (id: string, frame: DataFrame) => void;
}
export default function MapView({
  scene,
  stations,
  layers,
  time,
  dataRevision = 0,
  onReady,
  onStation,
  onFrame,
  resolvePluginFrame,
}: Props) {
  const pluginFrame = useRef(resolvePluginFrame);
  pluginFrame.current = resolvePluginFrame;
  const previousLayerIds = useRef(new Set(layers.map((layer) => layer.id)));
  const frameCallback = useRef(onFrame);
  frameCallback.current = onFrame;
  const latestStations = useRef(stations),
    latestLayers = useRef(layers);
  latestStations.current = stations;
  latestLayers.current = layers;
  const container = useRef<HTMLDivElement>(null),
    currentTime = useRef(time),
    runtimeRef = useRef<LayerRuntime | null>(null),
    viewerRef = useRef<Viewer | null>(null);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState(false);
  const [cameraRevision, setCameraRevision] = useState(0);
  currentTime.current = time;
  // 地图引擎只在地图组件挂载时加载；场景切换和卸载必须销毁 Viewer 与图层资源。
  useEffect(() => {
    let disposed = false;
    const lifecycle = new AbortController();
    let disposeTerrain: (() => void) | undefined;
    let viewer: Viewer | undefined;
    const removeCameraListeners: Array<() => void> = [];
    let runtime: LayerRuntime | undefined;
    let handler: ScreenSpaceEventHandler | undefined;
    let removeTerrainErrorListener: (() => void) | undefined;
    let terrainLoadTimer: number | undefined;
    let previousIonAccessToken: string | undefined;
    let activeIonAccessToken: string | undefined;
    let drawing: {
      kind: "distance" | "area";
      points: Coordinate[];
      onUpdate: (points: Coordinate[], done: boolean) => void;
    } | null = null;
    let pickOnce: ((lon: number, lat: number, height: number) => void) | null =
      null;
    let restorePickCursor: (() => void) | null = null;
    let stopCruise: (() => void) | null = null;
    let drawingSource: CustomDataSource | undefined;
    // Cesium 与本地运行配置异步初始化；未完成前卸载时不再创建浏览器资源。
    const initialize = async () => {
      try {
        const config = await runtimeConfig(lifecycle.signal);
        if (disposed || !container.current) return;
        // 默认地图不调用 Cesium ion，因此移除 Cesium 自动添加的 ion 品牌标识。
        // 数据源自己的版权署名仍走 CreditDisplay；若后续真正接入 ion，ion 返回的署名会再次显示。
        CreditDisplay.cesiumCredit = new Credit("", true);
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
        viewerRef.current = v;
        removeCameraListeners.push(
          v.camera.moveStart.addEventListener(() => {
            if (!disposed) setMoving(true);
          }),
        );
        removeCameraListeners.push(
          v.camera.moveEnd.addEventListener(() => {
            if (!disposed) {
              setMoving(false);
              setCameraRevision((value) => value + 1);
            }
          }),
        );
        let cameraTouched = false;
        const markCameraTouched = () => { cameraTouched = true; };
        v.scene.canvas.addEventListener("pointerdown", markCameraTouched, true);
        v.scene.canvas.addEventListener("wheel", markCameraTouched, true);
        removeCameraListeners.push(() => {
          v.scene.canvas.removeEventListener("pointerdown", markCameraTouched, true);
          v.scene.canvas.removeEventListener("wheel", markCameraTouched, true);
        });
        v.scene.globe.baseColor = Color.fromCssColorString("#d9e6dd");
        v.scene.backgroundColor = Color.fromCssColorString("#d9e5ed");
        v.scene.globe.enableLighting = true;
        v.scene.verticalExaggeration = 1.2;
        v.scene.verticalExaggerationRelativeHeight = 0;
        const home = async () => {
          const fallback = () => v.camera.flyTo({
            // 缺少边界资源时仍使用配置中心，并保持真正的垂直俯视。
            destination: Cartesian3.fromDegrees(...scene.center, scene.height),
            orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
            duration: 0.7,
          });
          if (!scene.boundaryUrl) {
            fallback();
            return;
          }
          try {
            // 以行政边界范围计算首屏相机框，避免固定中心点和倾斜角造成边界偏移或裁切。
            const response = await fetch(scene.boundaryUrl, { signal: lifecycle.signal });
            if (!response.ok) throw new Error("场景边界读取失败");
            const boundaries = parseAdministrativeBoundary(await response.json());
            const coordinates = boundaries.flatMap((boundary) => boundary.coordinates);
            let west = 180, east = -180, south = 90, north = -90;
            for (let index = 0; index < coordinates.length; index += 2) {
              west = Math.min(west, coordinates[index]);
              east = Math.max(east, coordinates[index]);
              south = Math.min(south, coordinates[index + 1]);
              north = Math.max(north, coordinates[index + 1]);
            }
            if (west >= east || south >= north) throw new Error("场景边界范围无效");
            if (disposed || cameraTouched || lifecycle.signal.aborted) return;
            const longitudePadding = (east - west) * 0.35;
            const latitudePadding = (north - south) * 0.35;
            v.camera.flyTo({
              destination: Rectangle.fromDegrees(
                west - longitudePadding,
                south - latitudePadding,
                east + longitudePadding,
                north + latitudePadding,
              ),
              orientation: { heading: 0, pitch: CesiumMath.toRadians(-90), roll: 0 },
              duration: 0.8,
            });
          } catch {
            // 场景资源不可用时回退到配置视角；不覆盖用户已开始的地图操作。
            if (!disposed && !cameraTouched && !lifecycle.signal.aborted) fallback();
          }
        };
        void home();
        if (config.basemap) {
          const b = config.basemap;
          if (b.type === "tianditu") {
            const provider = createTiandituProvider(config.tiandituKey ?? "");
            const tiandituLayer = v.imageryLayers.addImageryProvider(
              provider,
              0,
            );
            let imageryFailedOver = false;
            const recovery = new ImageryRecovery();
            provider.errorEvent.addEventListener((tileError) => {
              if (disposed || imageryFailedOver || tileError.retry) return;
              if (recovery.record(tileError) !== "fallback") return;
              imageryFailedOver = true;
              void TileMapServiceImageryProvider.fromUrl(
                "/cesium/Assets/Textures/NaturalEarthII",
              )
                .then((fallbackProvider) => {
                  if (disposed || v.isDestroyed()) return;
                  v.imageryLayers.addImageryProvider(fallbackProvider, 0);
                  v.imageryLayers.remove(tiandituLayer, true);
                  setError(
                    "天地图影像瓦片访问失败，请检查浏览器端 Key、来源域名授权和网络连接；已切换本地底图",
                  );
                })
                .catch(() => {
                  if (!disposed) {
                    setError(
                      "天地图影像和本地底图均无法加载，请检查网络连接后重试",
                    );
                  }
                });
            });
          } else {
            const provider =
              b.type === "wmts"
                ? new WebMapTileServiceImageryProvider({
                    url: b.url ?? "",
                    layer: b.layer ?? "",
                    style: b.style ?? "default",
                    format: b.format ?? "image/png",
                    tileMatrixSetID: b.tileMatrixSetID ?? "w",
                  })
                : new UrlTemplateImageryProvider({ url: b.url ?? "" });
            v.imageryLayers.addImageryProvider(provider, 0);
            provider.errorEvent.addEventListener(() =>
              setError("内网底图加载失败，请检查服务与权限"),
            );
          }
        } else {
          const provider = await TileMapServiceImageryProvider.fromUrl(
            "/cesium/Assets/Textures/NaturalEarthII",
          );
          if (disposed) return;
          v.imageryLayers.addImageryProvider(provider, 0);
        }
        const configuredTerrain = Boolean(
          (config.basemap?.type === "tianditu" && config.tiandituKey) ||
            config.terrainUrl ||
            config.cesiumIonAccessToken,
        );
        const setEllipsoidFallback = () => {
          if (disposed || v.isDestroyed()) return;
          v.terrainProvider = new EllipsoidTerrainProvider();
          v.scene.globe.depthTestAgainstTerrain = false;
        };
        if (!configuredTerrain) {
          setEllipsoidFallback();
        } else {
          // 地形网络请求在后台执行，不阻塞图层运行时、测量工具和 onReady 初始化。
          void (async () => {
            const useTiandituTerrain = Boolean(
              config.basemap?.type === "tianditu" && config.tiandituKey,
            );
            const providerName = useTiandituTerrain
              ? "天地图"
              : config.terrainUrl
                ? "内网地形服务"
                : "Cesium ion";
            try {
              let terrainPromise: Promise<TerrainProvider>;
              if (useTiandituTerrain) {
                const terrain = createTiandituTerrainProvider(
                  config.tiandituKey!,
                );
                disposeTerrain = () => terrain.dispose();
                terrainPromise = Promise.resolve(terrain);
              } else if (config.terrainUrl) {
                terrainPromise = CesiumTerrainProvider.fromUrl(
                  config.terrainUrl,
                );
              } else {
                const token = config.cesiumIonAccessToken;
                if (!token) throw new Error("未配置 Cesium ion 令牌");
                // 令牌由登录保护的 API 配置接口提供；使用者应限制站点来源和可访问资源。
                previousIonAccessToken = Ion.defaultAccessToken;
                activeIonAccessToken = token;
                Ion.defaultAccessToken = activeIonAccessToken;
                terrainPromise = createWorldTerrainAsync();
              }
              const terrainTimeout = new Promise<never>((_, reject) => {
                terrainLoadTimer = window.setTimeout(
                  () => reject(new Error("地形服务连接超时")),
                  15000,
                );
              });
              const terrain = await Promise.race([
                terrainPromise,
                terrainTimeout,
              ]);
              if (terrainLoadTimer !== undefined)
                window.clearTimeout(terrainLoadTimer);
              terrainLoadTimer = undefined;
              if (disposed || v.isDestroyed()) return;
              let terrainWarningShown = false;
              removeTerrainErrorListener = terrain.errorEvent.addEventListener(
                (tileError: TileProviderError) => {
                  if (disposed || v.isDestroyed()) return;
                  // 单个瓦片的网络错误不能把整套已加载地形替换成椭球；先让 Cesium 重试一次。
                  if (tileError.timesRetried < 1) {
                    tileError.retry = true;
                    return;
                  }
                  if (terrainWarningShown) return;
                  terrainWarningShown = true;
                  // 局部缺瓦由父级地形覆盖，仅记录诊断信息，不弹出干扰地图浏览的提示。
                  console.warn(
                    `${providerName}局部地形瓦片暂不可用，保留其余地形`,
                  );
                },
              );
              v.terrainProvider = terrain;
              v.scene.globe.depthTestAgainstTerrain = true;
            } catch {
              if (terrainLoadTimer !== undefined)
                window.clearTimeout(terrainLoadTimer);
              terrainLoadTimer = undefined;
              if (disposed) return;
              setEllipsoidFallback();
              setError(
                `${providerName}真实地形加载失败，请检查令牌、授权范围和网络连接`,
              );
            }
          })();
        }
        const createLayer = async (
          id: string,
          signal: AbortSignal,
        ): Promise<LayerHandle> => {
          const descriptor = latestLayers.current.find((l) => l.id === id);
          if (!descriptor) throw new Error("图层不存在");
          if (!descriptor.available)
            throw new Error(descriptor.reason ?? "未接入数据");
          const customFrame = id.includes(".")
            ? await pluginFrame.current?.(id, currentTime.current, signal)
            : null;
          if (id.includes(".") && !customFrame)
            throw new Error("插件Provider不可用");
          const frame =
            id === "boundary"
              ? null
              : (customFrame ??
                (await api.data(id, scene.id, currentTime.current, signal)));
          if (signal.aborted || disposed) throw new Error("加载已取消");
          const source = new CustomDataSource(id);
          let rasterCanvas: HTMLCanvasElement | undefined;
          const [lon, lat] = scene.center;
          const palette =
            id === "radar"
              ? [
                  "#2775cb",
                  "#27a6b8",
                  "#51bb54",
                  "#e5d63a",
                  "#ee6338",
                  "#b82844",
                ]
              : id === "satellite"
                ? ["#60758c", "#9caec0", "#d3dce5", "#f4f6f8", "#ffffff"]
                : id === "rainfall"
                  ? ["#cee9ff", "#72c3eb", "#2e91d1", "#1864b0", "#25449b"]
                  : id === "wind"
                    ? ["#f4e7d4", "#f0bf84", "#e98952", "#c54640", "#792b56"]
                    : id === "humidity"
                      ? ["#edf6fb", "#b9dfef", "#78bde0", "#398fc7", "#145b9d"]
                      : id === "warning"
                        ? [
                            "#f5f4df",
                            "#f4d54c",
                            "#f29b38",
                            "#e65335",
                            "#a9203a",
                          ]
                        : id === "simulation"
                          ? [
                              "#d8e6f6",
                              "#a5c4e6",
                              "#7c9ed0",
                              "#675da8",
                              "#413779",
                            ]
                          : id === "forecast"
                            ? [
                                "#4467a8",
                                "#64a5ca",
                                "#e1d981",
                                "#e99a56",
                                "#bd4c55",
                              ]
                            : [
                                "#e4e7a0",
                                "#d6d677",
                                "#e4c569",
                                "#e6a45c",
                                "#d98359",
                              ];
          const values = frame?.observations ?? [];
          if (id === "boundary") {
            if (scene.boundaryUrl) {
              const response = await fetch(scene.boundaryUrl, { signal });
              if (!response.ok) throw new Error("行政边界数据加载失败");
              const boundaries = parseAdministrativeBoundary(
                await response.json(),
              );
              if (signal.aborted || disposed) throw new Error("加载已取消");
              for (const boundary of boundaries) {
                source.entities.add({
                  name: boundary.name,
                  polyline: {
                    positions: Cartesian3.fromDegreesArray(
                      boundary.coordinates,
                    ),
                    clampToGround: true,
                    width: 5,
                    material: Color.fromCssColorString("#20b5da"),
                  },
                });
              }
            } else {
              source.entities.add({
                polyline: {
                  clampToGround: true,
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
                  width: 5,
                  material: Color.fromCssColorString("#20b5da"),
                },
              });
              source.entities.add({
                position: Cartesian3.fromDegrees(lon + 0.42, lat + 0.45),
                label: {
                  text: "示例范围 · 非行政边界",
                  heightReference: HeightReference.CLAMP_TO_GROUND,
                  font: "14px sans-serif",
                  fillColor: Color.fromCssColorString("#36586d"),
                  showBackground: true,
                  backgroundColor: Color.WHITE.withAlpha(0.85),
                  pixelOffset: new Cartesian2(0, -12),
                },
              });
            }
          } else if (customFrame) {
            for (const observation of values)
              source.entities.add({
                id: `${id}:${observation.stationId}`,
                position: Cartesian3.fromDegrees(
                  observation.location.lon,
                  observation.location.lat,
                  40,
                ),
                point: {
                  pixelSize: 12,
                  color: Color.fromCssColorString("#15a68b"),
                  outlineColor: Color.WHITE,
                  outlineWidth: 2,
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  disableDepthTestDistance: Infinity,
                },
                label: {
                  text: `${observation.stationId} · ${observation.elements[descriptor.valueField ?? "temperatureC"] ?? "—"} ${customFrame.unit}\n${customFrame.source} · ${descriptor.name}`,
                  font: "12px sans-serif",
                  fillColor: Color.WHITE,
                  showBackground: true,
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  pixelOffset: new Cartesian2(0, -22),
                  disableDepthTestDistance: Infinity,
                },
              });
          } else if (descriptor.rendererType === "station") {
            const visibleStations = latestStations.current.filter((s) =>
              id === "stations"
                ? s.type === "国家有人站"
                : s.type === descriptor.name,
            );
            await Promise.all(
              visibleStations.map(async (s) => {
                const marker = await createStationMarker(s.type);
                if (signal.aborted || disposed) return;
                source.entities.add({
                  id: s.id,
                  position: Cartesian3.fromDegrees(s.lon, s.lat, 40),
                  billboard: {
                    image: marker,
                    width: 30,
                    height: 30,
                    heightReference: HeightReference.RELATIVE_TO_GROUND,
                    verticalOrigin: VerticalOrigin.BOTTOM,
                    disableDepthTestDistance: Infinity,
                  },
                  label: {
                    heightReference: HeightReference.RELATIVE_TO_GROUND,
                    text: `${s.name}\n${values.find((o) => o.stationId === s.id)?.elements.temperatureC ?? "—"} °C`,
                    font: "13px sans-serif",
                    fillColor: Color.fromCssColorString("#243244"),
                    outlineColor: Color.WHITE,
                    outlineWidth: 3,
                    style: LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: VerticalOrigin.BOTTOM,
                    pixelOffset: new Cartesian2(0, -32),
                    disableDepthTestDistance: Infinity,
                  },
                });
              }),
            );
          } else if (
            id === "radar" ||
            id === "satellite" ||
            id === "forecast"
          ) {
            const raster = rasterizeWeather(frame?.gridCells ?? [], id);
            if (raster) {
              rasterCanvas = document.createElement("canvas");
              rasterCanvas.width = raster.width;
              rasterCanvas.height = raster.height;
              const context = rasterCanvas.getContext("2d");
              if (!context) throw new Error("浏览器无法创建气象栅格画布");
              const pixels = context.createImageData(
                raster.width,
                raster.height,
              );
              pixels.data.set(raster.pixels);
              context.putImageData(pixels, 0, 0);
              source.entities.add({
                id: `${id}-raster`,
                rectangle: {
                  coordinates: Rectangle.fromDegrees(...raster.bounds),
                  material: new ImageMaterialProperty({
                    image: rasterCanvas,
                    transparent: true,
                  }),
                  heightReference: HeightReference.CLAMP_TO_GROUND,
                },
              });
            }
          } else if (id === "wind") {
            for (const glyph of windGlyphs(frame?.gridCells ?? [])) {
              source.entities.add({
                id: glyph.id,
                polyline: {
                  positions: Cartesian3.fromDegreesArray([
                    ...glyph.start,
                    ...glyph.end,
                  ]),
                  clampToGround: true,
                  width: 7,
                  material: new PolylineArrowMaterialProperty(
                    Color.fromCssColorString(
                      glyph.speed >= 12
                        ? "#ff7043"
                        : glyph.speed >= 6
                          ? "#ffc857"
                          : "#39c9ed",
                    ),
                  ),
                },
              });
            }
          } else if (frame?.gridCells?.length) {
            for (const cell of frame.gridCells) {
              const range =
                id === "radar"
                  ? 70
                  : id === "wind"
                    ? 25
                    : id === "forecast"
                      ? 45
                      : id === "warning"
                        ? 4
                        : 100;
              const bucket = Math.max(
                0,
                Math.min(
                  palette.length - 1,
                  Math.floor((cell.value / range) * palette.length),
                ),
              );
              const alpha =
                id === "satellite"
                  ? 0.15 + (cell.value / 100) * 0.52
                  : id === "warning"
                    ? cell.value === 0
                      ? 0.03
                      : 0.34 + (cell.value / range) * 0.5
                    : 0.4 + Math.min(1, cell.value / range) * 0.42;
              source.entities.add({
                id: cell.id,
                rectangle: {
                  coordinates: Rectangle.fromDegrees(...cell.bounds),
                  material: Color.fromCssColorString(palette[bucket]).withAlpha(
                    alpha,
                  ),
                  heightReference: HeightReference.CLAMP_TO_GROUND,
                },
              });
            }
          } else {
            for (let row = 0; row < 8; row++)
              for (let col = 0; col < 10; col++) {
                const x = lon - 0.55 + col * 0.117,
                  y = lat - 0.42 + row * 0.1125;
                const idx =
                  (row +
                    col +
                    new Date(
                      frame?.observedAt ?? currentTime.current,
                    ).getUTCHours() +
                    8) %
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
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                  },
                });
              }
          }
          if (signal.aborted || disposed) throw new Error("加载已取消");
          await v.dataSources.add(source);
          if (signal.aborted || disposed) {
            if (!v.isDestroyed()) v.dataSources.remove(source, true);
            throw new Error("加载已取消");
          }
          const baseColors = new Map<Entity, Color>();
          source.entities.values.forEach((e) => {
            const m = e.rectangle?.material;
            if (
              m instanceof ColorMaterialProperty ||
              m instanceof ImageMaterialProperty
            )
              baseColors.set(
                e,
                m.color?.getValue(v.clock.currentTime) ?? Color.WHITE,
              );
          });
          if (frame) frameCallback.current?.(id, frame);
          const arrowColors = new Map<Entity, Color>();
          for (const entity of source.entities.values) {
            const material = entity.polyline?.material;
            if (material instanceof PolylineArrowMaterialProperty)
              arrowColors.set(
                entity,
                material.color?.getValue(v.clock.currentTime) ?? Color.WHITE,
              );
          }
          v.scene.requestRender();
          return {
            setOpacity(value) {
              source.entities.values.forEach((e) => {
                const color = baseColors.get(e);
                if (color && e.rectangle) {
                  const material = e.rectangle.material;
                  if (material instanceof ImageMaterialProperty)
                    material.color = new ConstantProperty(
                      color.withAlpha(color.alpha * value),
                    );
                  else
                    e.rectangle.material = new ColorMaterialProperty(
                      color.withAlpha(color.alpha * value),
                    );
                }
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
                if (e.polyline) {
                  const arrowColor = arrowColors.get(e);
                  if (
                    arrowColor &&
                    e.polyline.material instanceof PolylineArrowMaterialProperty
                  )
                    e.polyline.material.color = new ConstantProperty(
                      arrowColor.withAlpha(value),
                    );
                  else
                    e.polyline.material = new ColorMaterialProperty(
                      Color.fromCssColorString("#20b5da").withAlpha(value),
                    );
                }
              });
              v.scene.requestRender();
            },
            async setTime(nextTime) {
              currentTime.current = nextTime;
              await runtime?.toggle(id, true);
            },
            dispose() {
              if (rasterCanvas) {
                rasterCanvas.width = 0;
                rasterCanvas.height = 0;
              }
              if (!v.isDestroyed()) {
                v.dataSources.remove(source, true);
                v.scene.requestRender();
              }
            },
          };
        };
        previousLayerIds.current = new Set(
          latestLayers.current.map((layer) => layer.id),
        );
        runtime = new LayerRuntime(createLayer);
        runtimeRef.current = runtime;
        drawingSource = new CustomDataSource("drawing");
        void v.dataSources.add(drawingSource);
        const clearDrawing = () => {
          if (v.isDestroyed()) return;
          drawing = null;
          pickOnce = null;
          restorePickCursor?.();
          restorePickCursor = null;
          drawingSource?.entities.removeAll();
          v.scene.requestRender();
        };
        let deviceAlertEntity: Entity | undefined;
        const map: MapFacade = {
          showDeviceAlert: (device) => {
            if (v.isDestroyed()) return;
            if (deviceAlertEntity) v.entities.remove(deviceAlertEntity);
            // 演示设备标记属于当前 Viewer，场景切换销毁 Viewer 时一并释放。
            deviceAlertEntity = v.entities.add({
              position: Cartesian3.fromDegrees(device.lon, device.lat),
              point: { pixelSize: 15, color: device.alert ? Color.ORANGE : Color.CYAN, outlineColor: Color.WHITE, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND },
              label: { text: `${device.name}\n${device.alert ?? "Mock 设备"}`, font: "15px sans-serif", fillColor: Color.WHITE, showBackground: true, pixelOffset: new Cartesian2(0, -28), verticalOrigin: VerticalOrigin.BOTTOM },
            });
            v.scene.requestRender();
          },
          showCruisePath: (points) => {
            const source = new CustomDataSource("cruise-path");
            if (points.length > 1)
              source.entities.add({
                polyline: {
                  positions: Cartesian3.fromDegreesArrayHeights(
                    points.flatMap((p) => [p.lon, p.lat, p.height + 30]),
                  ),
                  width: 4,
                  material: Color.CYAN,
                  depthFailMaterial: Color.WHITE,
                },
              });
            points.forEach((p, i) =>
              source.entities.add({
                position: Cartesian3.fromDegrees(p.lon, p.lat, p.height + 40),
                point: {
                  pixelSize: 15,
                  color: Color.fromCssColorString("#1263c4"),
                  outlineColor: Color.WHITE,
                  outlineWidth: 3,
                  disableDepthTestDistance: Infinity,
                },
                label: {
                  text: `${i + 1} ${p.name}`,
                  font: "14px sans-serif",
                  fillColor: Color.WHITE,
                  showBackground: true,
                  pixelOffset: new Cartesian2(0, -28),
                  disableDepthTestDistance: Infinity,
                },
              }),
            );
            let cancelled = false;
            const ready = v.dataSources.add(source).then(() => {
              if (!v.isDestroyed()) {
                if (cancelled) v.dataSources.remove(source, true);
                v.scene.requestRender();
              }
            });
            return () => {
              cancelled = true;
              void ready.then(() => {
                if (!v.isDestroyed()) {
                  v.dataSources.remove(source, true);
                  v.scene.requestRender();
                }
              });
            };
          },
          tilt: () => {
            v.camera.setView({
              orientation: {
                heading: v.camera.heading,
                pitch: Math.max(-1.5, v.camera.pitch + 0.2),
                roll: 0,
              },
            });
            v.scene.requestRender();
          },
          rotate: () => {
            v.camera.setView({
              orientation: {
                heading: v.camera.heading + 0.3,
                pitch: v.camera.pitch,
                roll: 0,
              },
            });
            v.scene.requestRender();
          },
          captureView: () => {
            const p = v.camera.positionCartographic;
            return {
              lon: CesiumMath.toDegrees(p.longitude),
              lat: CesiumMath.toDegrees(p.latitude),
              height: p.height,
              heading: v.camera.heading,
              pitch: v.camera.pitch,
              roll: v.camera.roll,
            };
          },
          restoreView: (view) =>
            v.camera.flyTo({
              destination: Cartesian3.fromDegrees(
                view.lon,
                view.lat,
                view.height,
              ),
              orientation: {
                heading: view.heading,
                pitch: view.pitch,
                roll: view.roll,
              },
              duration: 0.7,
            }),
          beginMeasure: (kind, onUpdate) => {
            stopCruise?.();
            clearDrawing();
            drawing = { kind, points: [], onUpdate };
            return clearDrawing;
          },
          pickCoordinate: (callback) => {
            stopCruise?.();
            clearDrawing();
            pickOnce = callback;
            const canvas = v.scene.canvas;
            const previousCursor = canvas.style.cursor;
            canvas.style.cursor = "crosshair";
            restorePickCursor = () => {
              canvas.style.cursor = previousCursor;
            };
            return clearDrawing;
          },
          placeModel: (url, lon, lat, height, scale, heading) => {
            const position = Cartesian3.fromDegrees(lon, lat, height);
            const entity = v.entities.add({
              position,
              orientation: Transforms.headingPitchRollQuaternion(
                position,
                new HeadingPitchRoll(CesiumMath.toRadians(heading), 0, 0),
              ),
              model: { uri: url, scale, minimumPixelSize: 24 },
            });
            v.scene.requestRender();
            return () => {
              if (!v.isDestroyed()) {
                v.entities.remove(entity);
                v.scene.requestRender();
              }
            };
          },
          startCruise: (points, onProgress) => {
            stopCruise?.();
            clearDrawing();
            let index = 0,
              elapsed = 0,
              phase: "transition" | "orbit" = "transition",
              paused = false,
              stopped = false,
              frameId = 0,
              last = performance.now(),
              lastReport = 0;
            const report = (
              state: "playing" | "paused" | "stopped" | "complete",
            ) =>
              onProgress({
                index,
                phase,
                state,
                fraction: Math.min(
                  1,
                  elapsed /
                    (phase === "transition"
                      ? points[index].transition
                      : points[index].duration),
                ),
              });
            // 节点跳转后直接对准目标站点，并沿用节点保存的相机视角参数。
            const focusPoint = (point: (typeof points)[number]) => {
              v.camera.lookAt(
                Cartesian3.fromDegrees(point.lon, point.lat, point.height),
                new HeadingPitchRange(
                  point.view?.heading ?? 0,
                  point.view?.pitch ?? CesiumMath.toRadians(point.pitch),
                  point.view
                    ? Math.max(
                        100,
                        point.view.height /
                          Math.max(0.1, Math.abs(Math.sin(point.view.pitch))),
                      )
                    : point.radius,
                ),
              );
              v.scene.requestRender();
            };
            const stop = () => {
              if (stopped) return;
              stopped = true;
              cancelAnimationFrame(frameId);
              if (!v.isDestroyed()) {
                v.camera.lookAtTransform(Matrix4.IDENTITY);
                v.scene.requestRender();
              }
              report("stopped");
            };
            stopCruise = stop;
            const tick = (now: number) => {
              if (stopped || disposed) return;
              const dt = Math.min(0.1, (now - last) / 1000);
              last = now;
              if (!paused) {
                elapsed += dt;
                const p = points[index],
                  previous = points[Math.max(0, index - 1)];
                const duration =
                  phase === "transition" ? p.transition : p.duration;
                const t = Math.min(1, elapsed / duration);
                const k =
                  phase === "transition"
                    ? p.curve === "linear"
                      ? t
                      : t * t * (3 - 2 * t)
                    : 1;
                const lon = previous.lon + (p.lon - previous.lon) * k,
                  lat = previous.lat + (p.lat - previous.lat) * k;
                const heading =
                  phase === "orbit"
                    ? t *
                      CesiumMath.toRadians(p.angle ?? 360) *
                      p.loops *
                      p.direction
                    : 0;
                v.camera.lookAt(
                  Cartesian3.fromDegrees(
                    lon,
                    lat,
                    p.height +
                      (phase === "transition"
                        ? Math.sin(Math.PI * t) * (p.flightHeight ?? 3000)
                        : 0),
                  ),
                  new HeadingPitchRange(
                    (p.view?.heading ?? 0) + heading,
                    p.view?.pitch ?? CesiumMath.toRadians(p.pitch),
                    p.view
                      ? Math.max(
                          100,
                          p.view.height /
                            Math.max(0.1, Math.abs(Math.sin(p.view.pitch))),
                        )
                      : p.radius,
                  ),
                );
                v.scene.requestRender();
                if (now - lastReport > 100) {
                  report("playing");
                  lastReport = now;
                }
                if (t === 1) {
                  elapsed = 0;
                  if (phase === "transition") phase = "orbit";
                  else if (index < points.length - 1) {
                    index++;
                    phase = "transition";
                  } else {
                    stopped = true;
                    v.camera.lookAtTransform(Matrix4.IDENTITY);
                    onProgress({
                      index,
                      phase,
                      state: "complete",
                      fraction: 1,
                    });
                    return;
                  }
                }
              }
              frameId = requestAnimationFrame(tick);
            };
            report("playing");
            frameId = requestAnimationFrame(tick);
            return {
              pause() {
                paused = true;
                report("paused");
              },
              resume() {
                paused = false;
                last = performance.now();
                report("playing");
              },
              seek(nextIndex) {
                if (stopped || !Number.isFinite(nextIndex)) return;
                index = Math.max(0, Math.min(points.length - 1, Math.round(nextIndex)));
                phase = "orbit";
                elapsed = 0;
                focusPoint(points[index]);
                report(paused ? "paused" : "playing");
              },
              stop,
            };
          },
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
          if (drawing || pickOnce) {
            const ray = v.camera.getPickRay(click.position);
            // 优先拾取实际地形；地形瓦片尚未加载或服务不可用时回退到椭球，保证仍可添加坐标点。
            const world = (ray ? v.scene.globe.pick(ray, v.scene) : undefined)
              ?? v.camera.pickEllipsoid(click.position, v.scene.globe.ellipsoid);
            if (!world) return;
            const c = Cartographic.fromCartesian(world);
            const lon = CesiumMath.toDegrees(c.longitude),
              lat = CesiumMath.toDegrees(c.latitude);
            if (pickOnce) {
              const callback = pickOnce;
              pickOnce = null;
              restorePickCursor?.();
              restorePickCursor = null;
              callback(lon, lat, c.height);
              return;
            }
            if (drawing) {
              drawing.points.push([lon, lat]);
              const pts = drawing.points;
              drawingSource?.entities.removeAll();
              drawingSource?.entities.add({
                polyline: {
                  clampToGround: true,
                  positions: Cartesian3.fromDegreesArray(pts.flat()),
                  width: 3,
                  material: Color.CYAN,
                },
              });
              if (drawing.kind === "area" && pts.length >= 3)
                drawingSource?.entities.add({
                  polygon: {
                    heightReference: HeightReference.CLAMP_TO_GROUND,
                    hierarchy: new PolygonHierarchy(
                      Cartesian3.fromDegreesArray(pts.flat()),
                    ),
                    material: Color.CYAN.withAlpha(0.25),
                  },
                });
              drawingSource?.entities.add({
                position: world,
                label: {
                  heightReference: HeightReference.CLAMP_TO_GROUND,
                  text:
                    drawing.kind === "distance"
                      ? `${(distanceMeters(pts) / 1000).toFixed(3)} km`
                      : `${(areaMeters(pts) / 1e6).toFixed(3)} km²`,
                  font: "16px sans-serif",
                  fillColor: Color.WHITE,
                  showBackground: true,
                },
              });
              drawing.onUpdate([...pts], false);
              v.scene.requestRender();
              return;
            }
          }
          const pick = v.scene.pick(click.position);
          const station = latestStations.current.find(
            (s) => s.id === pick?.id?.id,
          );
          if (station) onStation(station);
        }, ScreenSpaceEventType.LEFT_CLICK);
        handler.setInputAction(() => {
          if (drawing) {
            drawing.onUpdate([...drawing.points], true);
            drawing = null;
          }
        }, ScreenSpaceEventType.RIGHT_CLICK);
        handler.setInputAction(
          () => stopCruise?.(),
          ScreenSpaceEventType.LEFT_DOWN,
        );
        onReady(runtime, map);
        if (latestLayers.current.some((layer) => layer.id === "boundary"))
          void runtime.toggle("boundary", true);
        if (latestLayers.current.some((layer) => layer.id === "stations"))
          void runtime.toggle("stations", true);
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "地图初始化失败");
      }
    };
    void initialize();
    return () => {
      // 先标记异步流程失效，再停止漫游、卸载图层和销毁 Cesium 输入及 Viewer。
      disposed = true;
      lifecycle.abort();
      disposeTerrain?.();
      if (terrainLoadTimer !== undefined) window.clearTimeout(terrainLoadTimer);
      removeTerrainErrorListener?.();
      removeCameraListeners.forEach((remove) => remove());
      if (
        activeIonAccessToken &&
        previousIonAccessToken &&
        Ion.defaultAccessToken === activeIonAccessToken
      ) {
        Ion.defaultAccessToken = previousIonAccessToken;
      }
      stopCruise?.();
      runtime?.dispose();
      runtimeRef.current = null;
      viewerRef.current = null;
      handler?.destroy();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, [scene, onReady, onStation]);
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const nextIds = new Set(layers.map((layer) => layer.id));
    for (const id of previousLayerIds.current)
      if (!nextIds.has(id)) void runtime.toggle(id, false);
    previousLayerIds.current = nextIds;
    for (const l of layers)
      if (
        l.id !== "boundary" &&
        ["on", "loading", "error"].includes(runtime.snapshot(l.id).status)
      )
        void runtime.toggle(l.id, true);
  }, [time, stations, layers, dataRevision]);
  return (
    <>
      <div
        ref={container}
        className="map-canvas"
        aria-label="三维交互地图"
        aria-busy={moving}
        data-camera-revision={cameraRevision}
      />
      {error && (
        <Alert
          className="map-error"
          type="error"
          showIcon
          message={error}
          action={
            <UiButton size="small" onClick={() => window.location.reload()}>
              重新加载
            </UiButton>
          }
        />
      )}
    </>
  );
}
