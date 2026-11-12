import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  SceneSchema,
  LAYERS,
  DEMO_TIMES,
  demoStations,
  demoObservations,
  demoProductGrid,
  MOCK_LAYER_PRODUCTS,
  demoDevices,
  mockForecastMetadata,
  type SceneConfig,
} from "@dtv/contracts";
import xian from "../../../scenarios/xian.json";
import taiyuan from "../../../scenarios/taiyuan.json";
import chengdu from "../../../scenarios/chengdu.json";
export class DemoService {
  private configs = [xian, taiyuan, chengdu].map((x) => SceneSchema.parse(x));
  scenes() {
    return this.configs;
  }
  scene(id: string) {
    const scene = this.configs.find((s) => s.id === id);
    if (!scene) throw new NotFoundException("场景不存在");
    return scene;
  }
  layers(sceneId: string, scene: SceneConfig = this.scene(sceneId)) {
    return LAYERS.filter((layer) => !scene.enabledLayers || scene.enabledLayers.includes(layer.id)).map((layer) => layer.id === "boundary" && scene.boundaryUrl
      ? { ...layer, name: "行政边界", tag: "区县", reason: `${scene.name}行政边界数据` }
      : layer);

  }
  layer(id: string) {
    const layer = LAYERS.find((l) => l.id === id);
    if (!layer) throw new NotFoundException("图层不存在");
    return layer;
  }
  stations(sceneId: string, scene: SceneConfig = this.scene(sceneId)) {
    return demoStations(scene);
  }
  devices(sceneId: string, now = new Date(), scene: SceneConfig = this.scene(sceneId)) {
    return demoDevices(scene, now);
  }
  times(id: string) {
    this.layer(id);
    return DEMO_TIMES;
  }
  data(id: string, sceneId: string, time: string, scene: SceneConfig = this.scene(sceneId)) {
    const layer = this.layer(id);
    if (!layer.available) throw new NotFoundException(layer.reason);
    if (!DEMO_TIMES.includes(time))
      throw new NotFoundException("对应时次无数据");
    const mockProduct = MOCK_LAYER_PRODUCTS[id];
    return {
      source: "mock" as const,
      storage: "generated" as const,
      observedAt: time,
      unit: layer.unit,
      crs: "EPSG:4326" as const,
      ...(id === "forecast" ? { forecast: mockForecastMetadata(time) } : {}),
      observations: mockProduct ? [] : demoObservations(scene, time),
      ...(mockProduct ? { gridCells: demoProductGrid(scene, time, mockProduct) } : {}),
    };
  }
  search(sceneId: string, q: string, scene: SceneConfig = this.scene(sceneId)) {
    if (typeof q !== "string") throw new BadRequestException("搜索词格式错误");
    q = q.trim();
    if (q.length > 100) throw new BadRequestException("搜索词过长");
    if (q.includes(",") || q.includes("，")) {
      const rawParts = q.split(/[,，]/);
      if (rawParts.some((part) => !part.trim()))
        throw new BadRequestException("坐标经纬度不能为空");
      const parts = rawParts.map(Number);
      if (
        parts.length !== 2 ||
        parts.some((x) => !Number.isFinite(x)) ||
        Math.abs(parts[0]) > 180 ||
        Math.abs(parts[1]) > 90
      )
        throw new BadRequestException("坐标格式应为有效经度,纬度");
      return {
        layers: [],
        stations: [],
        coordinate: parts as [number, number],
      };
    }
    return {
      layers: this.layers(sceneId, scene).filter((x) => x.name.includes(q)),
      stations: this.stations(sceneId, scene).filter(
        (x) => x.name.includes(q) || x.id.includes(q),
      ),
    };
  }
}
