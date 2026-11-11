import { expect, test } from "vitest";
import { decodeTiandituHeightmap } from "../apps/web/src/tiandituTerrain";
test("高程采用小端有符号整数，保留低于海平面的有效值及端点", () => {
  const bytes = new Uint8Array(150 * 150 * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < 150 * 150; i++) view.setInt16(i * 2, 432, true);
  view.setInt16(0, -120, true);
  view.setInt16(bytes.length - 2, 2300, true);
  const result = decodeTiandituHeightmap(bytes);
  expect(result).toHaveLength(4096);
  expect(result[0]).toBe(-120);
  expect(result[1]).toBe(432);
  expect(result.at(-1)).toBe(2300);
  expect(() => decodeTiandituHeightmap(new Uint8Array(5))).toThrow("长度异常");
});
