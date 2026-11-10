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
  layers(sceneId: string) {
    this.scene(sceneId);
    return LAYERS;
  }
  layer(id: string) {
    const layer = LAYERS.find((l) => l.id === id);
    if (!layer) throw new NotFoundException("图层不存在");
    return layer;
  }
  stations(sceneId: string) {
    return demoStations(this.scene(sceneId));
  }
  devices(sceneId: string, now = new Date()) {
    return demoDevices(this.scene(sceneId), now);
  }
  times(id: string) {
    this.layer(id);
    return DEMO_TIMES;
  }
  data(id: string, sceneId: string, time: string) {
    const layer = this.layer(id),
      scene = this.scene(sceneId);
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
      observations: mockProduct ? [] : demoObservations(scene, time),
      ...(mockProduct ? { gridCells: demoProductGrid(scene, time, mockProduct) } : {}),
    };
  }
  search(sceneId: string, q: string) {
    this.scene(sceneId);
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
      layers: LAYERS.filter((x) => x.name.includes(q)),
      stations: this.stations(sceneId).filter(
        (x) => x.name.includes(q) || x.id.includes(q),
      ),
    };
  }
}
