export interface SampleSummary {
  count: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
}

export function summarizeSamples(samples: number[]): SampleSummary {
  const sorted = samples
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!sorted.length) throw new Error("至少需要一个有效样本");
  const percentile = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1],
  };
}
