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
