import { expect, it } from "vitest";
import { deriveMockWeatherWarning, type WeatherObservation } from "@dtv/contracts";

const sample: WeatherObservation = {
  source: "mock",
  stationId: "xian-57000",
  observedAt: "2026-11-07T00:00:00.000Z",
  ingestedAt: "2026-11-07T00:00:00.000Z",
  location: { lon: 108.9, lat: 34.2, crs: "EPSG:4326" },
  elements: { temperatureC: 12, rainfallMm: 4.2, windSpeedMs: 5.1 },
  quality: { mock: "deterministic" },
};

it("Mock 预警规则按专题阈值生成标签，并在没有命中时返回空", () => {
  expect(deriveMockWeatherWarning("rainstorm", sample)?.level).toBe("橙色 Mock");
  expect(deriveMockWeatherWarning("convection", sample)?.type).toContain("模拟");
  expect(deriveMockWeatherWarning("cold-snow", sample)?.value).toBe(12);
  expect(deriveMockWeatherWarning("flash-flood", sample, 700)).toBeNull();
  expect(deriveMockWeatherWarning("rainstorm", { ...sample, elements: { ...sample.elements, rainfallMm: 0 } })).toBeNull();
  expect(deriveMockWeatherWarning("rainstorm", undefined)).toBeNull();
});
