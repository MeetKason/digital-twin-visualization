import { expect, test } from "vitest";
import { rasterizeGridAnalysis, rasterizeWeather, windGlyphs, weatherColor, windSpeedRgb } from "../apps/web/src/weatherRendering";
import { demoProductGrid, demoProductObservations, productGridFromObservations, SceneSchema } from "@dtv/contracts";
import xian from "../scenarios/xian.json";
const scene = SceneSchema.parse(xian);

test("雷达连续栅格由数值生成，低回波透明，缺测单元不伪造零值", () => {
  const grid = [
    { id: "left", bounds: [0, 0, 1, 1] as [number, number, number, number], value: 0 },
    { id: "right", bounds: [1, 0, 2, 1] as [number, number, number, number], value: 60 },
  ];
  const raster = rasterizeWeather(grid, "radar", 40, 10)!;
  expect(raster.bounds).toEqual([0, 0, 2, 1]);
  expect(raster.pixels[3]).toBe(0);
  expect(raster.pixels.at(-1)).toBeGreaterThan(0);
  expect(rasterizeWeather([], "satellite")).toBeNull();
  expect(raster.pixels).not.toEqual(rasterizeWeather(grid.map((cell) => ({ ...cell, value: 0 })), "radar", 40, 10)!.pixels);
});

test("风场色标从低风速青色过渡到高风速红色，超出范围停在两端", () => {
  const calm = windSpeedRgb(0);
  const fresh = windSpeedRgb(12);
  const gale = windSpeedRgb(30);
  expect(calm[2]).toBeGreaterThan(calm[0]);
  expect(gale[0]).toBeGreaterThan(gale[2]);
  expect(fresh[0]).toBeGreaterThan(180);
  expect(fresh[1]).toBeGreaterThan(150);
  expect(windSpeedRgb(-4)).toEqual(calm);
  expect(windSpeedRgb(80)).toEqual(gale);
});

test("风向箭头按气象来向转成去向；无风向数据不伪造箭头", () => {
  const glyphs = windGlyphs([{ id: "north", bounds: [108, 34, 109, 35], value: 10, directionDeg: 0 }]);
  expect(glyphs).toHaveLength(1);
  expect(glyphs[0].end[1]).toBeLessThan(glyphs[0].start[1]);
  expect(windGlyphs([{ id: "unknown", bounds: [108, 34, 109, 35], value: 10 }])).toHaveLength(0);
});

test("模拟与入库风场保持风速风向，缺测产品不映射为0", () => {
  const cells = demoProductGrid(scene, "2026-11-07T00:00:00+08:00", "wind-field");
  const observations = demoProductObservations(scene, "2026-11-07T00:00:00+08:00", "wind-field");
  const stored = productGridFromObservations(observations, "wind-field");
  expect(stored[0].directionDeg).toBe(cells[0].directionDeg);
  expect(stored[0].directionDeg).toBeGreaterThanOrEqual(0);
  observations[0].elements.windFieldMs = null;
  expect(productGridFromObservations(observations, "wind-field")).toHaveLength(79);
});


test("预报支持零下温度并连续映射色阶，不产生负数色阶索引", () => {
  expect(weatherColor(-20, "forecast")).toEqual([55, 112, 191, 165]);
  expect(weatherColor(45, "forecast")).toEqual([221, 113, 71, 165]);
  expect(weatherColor(-10, "forecast")).not.toEqual(weatherColor(10, "forecast"));
});


test("网格实况插值铺满行政区范围，并保留真实观测格点的数值色阶", () => {
  const cells = [
    { id: "west-south", bounds: [108.2, 33.8, 108.4, 34.0] as [number, number, number, number], value: 10 },
    { id: "east-south", bounds: [108.4, 33.8, 108.6, 34.0] as [number, number, number, number], value: 50 },
    { id: "west-north", bounds: [108.2, 34.0, 108.4, 34.2] as [number, number, number, number], value: 70 },
    { id: "east-north", bounds: [108.4, 34.0, 108.6, 34.2] as [number, number, number, number], value: 90 },
  ];
  const bounds: [number, number, number, number] = [108, 33.5, 109, 34.5];
  const raster = rasterizeGridAnalysis(cells, bounds, ["#e4e7a0", "#d6d677", "#e4c569", "#e6a45c", "#d98359"], 24, 16)!;
  expect(raster.bounds).toEqual(bounds);
  expect(raster.pixels).toHaveLength(24 * 16 * 4);
  expect(Array.from(raster.pixels).filter((_value, index) => index % 4 === 3 && _value > 0)).toHaveLength(24 * 16);
  expect(new Set(Array.from(raster.pixels).filter((_value, index) => index % 4 !== 3)).size).toBeGreaterThan(1);
  expect(rasterizeGridAnalysis([], bounds, ["#000000"], 4, 4)).toBeNull();
});
