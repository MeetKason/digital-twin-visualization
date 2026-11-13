import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { administrativeBounds, parseAdministrativeBoundary, parseAdministrativePolygons } from "../apps/web/src/administrativeBoundary";

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

it("气象裁剪保留多面与内环，并以整座城市边界计算栅格范围", () => {
  const data = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { name: "测试区" }, geometry: {
      type: "MultiPolygon", coordinates: [
        [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]],
        [[[5, 0], [6, 0], [6, 1], [5, 1], [5, 0]]],
      ],
    } }],
  };
  const polygons = parseAdministrativePolygons(data);
  expect(polygons).toHaveLength(2);
  expect(polygons[0]).toHaveLength(2);
  expect(administrativeBounds(polygons)).toEqual([0, 0, 6, 4]);
});

it("西安和太原的实际边界均可计算非空气象栅格范围", () => {
  for (const code of ["610100", "140100"]) {
    const data = JSON.parse(readFileSync(`apps/web/public/geojson/${code}.geojson`, "utf8"));
    const polygons = parseAdministrativePolygons(data);
    expect(polygons.length).toBeGreaterThan(0);
    const [west, south, east, north] = administrativeBounds(polygons);
    expect(east).toBeGreaterThan(west);
    expect(north).toBeGreaterThan(south);
  }
});
