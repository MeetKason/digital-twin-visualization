import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseAdministrativeBoundary } from "../apps/web/src/administrativeBoundary";

it("西安数据保留13个区县的全部多面与闭合环，坐标为经纬度", () => {
  const data = JSON.parse(readFileSync("apps/web/public/geojson/610100.geojson", "utf8"));
  expect(data.features).toHaveLength(13);
  const rings = parseAdministrativeBoundary(data);
  expect(new Set(rings.map((item) => item.name)).size).toBe(13);
  expect(rings.length).toBeGreaterThanOrEqual(13);
  for (const item of rings) {
    expect(item.coordinates.slice(0, 2)).toEqual(item.coordinates.slice(-2));
    expect(item.coordinates.every(Number.isFinite)).toBe(true);
  }
});
it("拒绝投影坐标和不闭合的边界，不能误绘为真实区划", () => {
  const data = JSON.parse(readFileSync("apps/web/public/geojson/610100.geojson", "utf8"));
  data.crs.properties.name = "EPSG:3857";
  expect(() => parseAdministrativeBoundary(data)).toThrow("只支持");
  delete data.crs;
  data.features[0].geometry.coordinates[0][0][0] = [108, 34];
  expect(() => parseAdministrativeBoundary(data)).toThrow("必须闭合");
});
