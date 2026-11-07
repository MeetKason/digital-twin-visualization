import { describe, it, expect } from "vitest";
import {
  parseCoordinate,
  distanceMeters,
  areaMeters,
  parseStationCsv,
  saveStation,
  movePoint,
  validatePlan,
} from "../packages/contracts/src/business";
describe("地图工具", () => {
  it("校验经纬度且空值不可转成0", () => {
    expect(parseCoordinate("108.94", "34.34")).toEqual([108.94, 34.34]);
    expect(() => parseCoordinate("", "34")).toThrow();
    expect(() => parseCoordinate("181", "34")).toThrow();
  });
  it("距离与面积有地理意义且面积不依赖顶点方向", () => {
    expect(
      distanceMeters([
        [0, 0],
        [1, 0],
      ]),
    ).toBeCloseTo(111195, -1);
    const points: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(areaMeters(points)).toBeGreaterThan(1.2e10);
    expect(areaMeters([...points].reverse())).toBeCloseTo(
      areaMeters(points),
      0,
    );
  });
});
describe("点位与方案", () => {
  const station = {
    id: "A",
    name: "站点A",
    sceneId: "xian",
    lon: 108,
    lat: 34,
    elevationM: 400,
    source: "mock" as const,
    type: "国家有人站",
  };
  it("编码唯一、坐标范围有效、编辑不新增重复对象", () => {
    expect(() =>
      saveStation([station], { ...station, id: "B", lon: 999 }),
    ).toThrow();
    expect(() => saveStation([station], station)).toThrow("编码");
    expect(
      saveStation([station], { ...station, name: "更新" }, "A"),
    ).toHaveLength(1);
  });
  it("CSV 支持引号，重复默认跳过，错误行逐条报告", () => {
    const r = parseStationCsv(
      '站点编码,名称,经度,纬度\nA,已有,108,34\nB,"测试,站",109,35\nC,错误,999,35',
      [station],
      "xian",
    );
    expect(r.imported[0].name).toBe("测试,站");
    expect(r.skipped).toBe(1);
    expect(r.errors[0].line).toBe(4);
  });
  it("两个方案的节点排序互不影响，空方案禁止保存/播放", () => {
    const a = [{ id: "1" }, { id: "2" }],
      b = [...a];
    expect(movePoint(a, 0, 1).map((x) => x.id)).toEqual(["2", "1"]);
    expect(b.map((x) => x.id)).toEqual(["1", "2"]);
    expect(() => validatePlan({ name: "", points: [] })).toThrow();
  });
});

it("损坏或跨地区的持久化资料不能进入页面状态", async () => {
  const { parseBusinessData } = await import(
    "../packages/contracts/src/business"
  );
  expect(
    parseBusinessData(
      {
        version: 1,
        stations: [],
        plans: [],
        assets: [],
        bookmarks: [],
        users: [],
      },
      "xian",
    ).version,
  ).toBe(1);
  expect(() =>
    parseBusinessData(
      {
        version: 1,
        stations: [{ name: {} }],
        plans: [],
        assets: [],
        bookmarks: [],
        users: [],
      },
      "xian",
    ),
  ).toThrow();
  expect(() =>
    parseBusinessData(
      {
        version: 1,
        stations: [
          {
            id: "A",
            name: "跨区",
            sceneId: "taiyuan",
            lon: 112,
            lat: 37,
            elevationM: 0,
            type: "国家有人站",
            source: "mock",
          },
        ],
        plans: [],
        assets: [],
        bookmarks: [],
        users: [],
      },
      "xian",
    ),
  ).toThrow();
});
it("CSV 导出防止公式解释且保留引号", async () => {
  const { csvCell } = await import("../packages/contracts/src/business");
  expect(csvCell("=1+1")).toBe('"\'=1+1"');
  expect(csvCell('测试"站')).toBe('"测试""站"');
});
