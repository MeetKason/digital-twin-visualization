import { describe, it, expect } from "vitest";
import { DemoService } from "../apps/core-api/src/service";
describe("场景与数据契约", () => {
  const service = new DemoService();
  it("三个地区切换返回各自站点并明确 Mock 来源", () => {
    expect(service.scenes()).toHaveLength(3);
    const x = service.stations("xian"),
      t = service.stations("taiyuan");
    expect(x[0].id).not.toBe(t[0].id);
    expect(x[0].source).toBe("mock");
  });
  it("设备清单返回可重复、带 Mock 来源的遥测状态", () => {
    const devices = service.devices("xian", new Date("2026-11-07T00:00:00Z"));
    expect(devices).toHaveLength(6);
    expect(devices.every((device) => device.source === "mock")).toBe(true);
    expect(new Set(devices.map((device) => device.status))).toEqual(new Set(["online", "warning", "offline"]));
    expect(service.devices("taiyuan")[0].id).not.toBe(devices[0].id);
  });
  it("未知场景与图层被拒绝，不返回默认地区", () => {
    expect(() => service.layers("unknown")).toThrow();
    expect(() => service.times("unknown")).toThrow();
  });
  it("无数据时次返回错误，不把旧时次冒充新时次", () => {
    expect(() =>
      service.data("temperature", "xian", "2099-01-01T00:00:00Z"),
    ).toThrow("无数据");
    const r = service.data(
      "temperature",
      "xian",
      service.times("temperature")[0],
    );
    expect(r.source).toBe("mock");
    expect(r.observedAt).toBe(service.times("temperature")[0]);
  });
  it("雷达与卫星提供可重复且明确标记为 Mock 的格点数据", () => {
    for (const [layerId, unit] of [["radar", "dBZ"], ["satellite", "%"]] as const) {
      expect(service.layer(layerId).available).toBe(true);
      const first = service.data(layerId, "xian", service.times(layerId)[0]);
      const second = service.data(layerId, "xian", service.times(layerId)[0]);
      expect(first).toMatchObject({ source: "mock", storage: "generated", unit });
      expect(first.gridCells).toHaveLength(80);
      expect(first.gridCells).toEqual(second.gridCells);
      expect(first.gridCells?.every((cell) => cell.value >= 0 && cell.value <= (layerId === "radar" ? 70 : 100))).toBe(true);
    }
  });
  it("风场、湿度、综合网格、预报、预警和环境模拟均有 Mock 格点", () => {
    for (const layerId of ["wind", "humidity", "grid", "forecast", "warning", "simulation"]) {
      const layer = service.layer(layerId);
      expect(layer.available).toBe(true);
      const frame = service.data(layerId, "taiyuan", service.times(layerId)[6]);
      expect(frame).toMatchObject({ source: "mock", storage: "generated" });
      expect(frame.gridCells).toHaveLength(80);
      expect(frame.gridCells?.every((cell) => Number.isFinite(cell.value))).toBe(true);
    }
  });
  it("搜索校验坐标，查询限定当前场景", () => {
    expect(() => service.search("xian", "999,999")).toThrow("坐标");
    expect(service.search("xian", "108.94,34.34").coordinate).toEqual([
      108.94, 34.34,
    ]);
    expect(service.search("taiyuan", "西安").stations).toHaveLength(0);
  });
});

it("坐标的经度纬度必须都有值，重复 query 参数不能引发 500", () => {
  const service = new DemoService();
  expect(() => service.search("xian", ",34")).toThrow("坐标");
  expect(() => service.search("xian", ["a", "b"] as unknown as string)).toThrow(
    "搜索",
  );
});

it("Mock预报给出同一有效时间的起报和时效，风场携带气象来向", () => {
  const service = new DemoService();
  const frame = service.data("forecast", "xian", service.times("forecast")[12]);
  expect(frame.forecast).toEqual({ referenceTime: "2026-11-06T16:00:00.000Z", validTime: "2026-11-07T04:00:00.000Z", leadHours: 12 });
  expect(service.data("wind", "xian", service.times("wind")[0]).gridCells!.every((cell) => cell.directionDeg != null && cell.directionDeg >= 0 && cell.directionDeg <= 360)).toBe(true);
});
