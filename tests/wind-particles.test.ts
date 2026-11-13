import { expect, test } from "vitest";
import {
  WIND_PARTICLE_BASE_COUNT,
  WIND_PARTICLE_TRAIL_LENGTH,
  buildWindFieldGrid,
  sampleWindField,
  windParticleCount,
  windParticleStroke,
} from "../apps/web/src/windParticles";

test("风场粒子数明显高于旧版稀疏密度，并随覆盖与视口缩放", () => {
  expect(WIND_PARTICLE_BASE_COUNT).toBeGreaterThanOrEqual(3000);
  expect(WIND_PARTICLE_TRAIL_LENGTH).toBeLessThanOrEqual(3);
  const dense = windParticleCount(1, 1280 * 720);
  const sparseFill = windParticleCount(0.2, 1280 * 720);
  const smallerView = windParticleCount(1, 800 * 500);
  expect(dense).toBeGreaterThanOrEqual(3000);
  expect(sparseFill).toBeLessThan(dense);
  expect(smallerView).toBeLessThan(dense);
  expect(smallerView).toBeGreaterThanOrEqual(2000);
});

test("风速描边色阶青黄橙红对齐图例区间", () => {
  const calm = windParticleStroke(3);
  const moderate = windParticleStroke(9);
  const strong = windParticleStroke(18);
  expect(calm.color.startsWith("rgba(")).toBe(true);
  expect(calm.lineWidth).toBeLessThan(moderate.lineWidth + 0.2);
  expect(Number(calm.color.match(/rgba\((\d+)/)?.[1])).toBeLessThan(120);
  expect(Number(moderate.color.match(/rgba\((\d+)/)?.[1])).toBeGreaterThan(140);
  expect(strong.color.startsWith("rgba(255,")).toBe(true);
  expect(strong.lineWidth).toBeGreaterThan(calm.lineWidth);
});

test("预采样风场网格可插值读取风向风速", () => {
  const field = buildWindFieldGrid(
    [
      { lon: 108.9, lat: 34.3, east: 0, north: 10, speed: 10 },
      { lon: 109.1, lat: 34.3, east: 8, north: 0, speed: 8 },
    ],
    [108.8, 34.2, 109.2, 34.4],
    32,
    32,
  );
  const northish = sampleWindField(field, 108.9, 34.3);
  const eastish = sampleWindField(field, 109.1, 34.3);
  expect(northish.speed).toBeGreaterThan(7);
  expect(northish.north).toBeGreaterThan(eastish.north);
  expect(eastish.east).toBeGreaterThan(northish.east);
});
