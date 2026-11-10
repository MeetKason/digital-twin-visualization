import { expect, it } from "vitest";
import { summarizeSamples } from "../scripts/performance-metrics";

it("summarizes repeated UI timings with deterministic p50 and p95", () => {
  expect(summarizeSamples([9, 1, 5, 3, 7])).toEqual({
    count: 5,
    min: 1,
    p50: 5,
    p95: 9,
    max: 9,
  });
});

it("rejects empty, negative and non-finite timing samples", () => {
  expect(() => summarizeSamples([])).toThrow("至少需要一个有效样本");
  expect(() => summarizeSamples([-1])).toThrow("至少需要一个有效样本");
  expect(() => summarizeSamples([Number.NaN])).toThrow("至少需要一个有效样本");
});
