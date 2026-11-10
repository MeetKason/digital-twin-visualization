import { expect, it } from "vitest";
import { renderIngestionMetrics } from "../packages/ingestion/src/metrics";

it("renders Prometheus counters using only bounded source and status labels", () => {
  const output = renderIngestionMetrics({
    jobs: [
      { source: "mock", status: "queued", count: 2 },
      { source: "tianqing", status: "failed", count: 1 },
    ],
    enabledSchedules: 1,
  });
  expect(output).toContain('dtv_ingestion_jobs{source="mock",status="queued"} 2');
  expect(output).toContain('dtv_ingestion_jobs{source="tianqing",status="failed"} 1');
  expect(output).toContain("dtv_ingestion_schedules_enabled 1");
  expect(output).not.toContain("tenant");
  expect(output).not.toContain("endpoint");
});

it("escapes or drops unrecognized labels and clamps invalid counters", () => {
  const output = renderIngestionMetrics({
    jobs: [{ source: 'mock"\nleak', status: "custom", count: -2 }],
    enabledSchedules: -1,
  });
  expect(output).not.toContain("leak");
  expect(output).not.toContain("custom");
  expect(output).toContain("dtv_ingestion_schedules_enabled 0");
});
