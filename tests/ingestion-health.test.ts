import { expect, it } from "vitest";
import { analyzeIngestionHealth } from "../packages/ingestion/src/health";

const now = Date.parse("2026-11-09T04:00:00.000Z");
const baseStatus = {
  productId: "surface-hourly",
  source: "mock" as const,
  mode: "ingested" as const,
  watermark: "2026-11-09T02:00:00.000Z",
  lastSuccessAt: "2026-11-09T02:01:00.000Z",
  schedule: { enabled: false, lastEnqueuedAt: null },
  jobs: [],
};
const job = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  productId: "surface-hourly",
  source: "mock" as const,
  kind: "manual" as const,
  startTime: "2026-11-09T00:00:00.000Z",
  endTime: "2026-11-09T02:00:00.000Z",
  cursor: "2026-11-09T02:00:00.000Z",
  status: "failed" as const,
  attempts: 3,
  completedHours: 2,
  totalHours: 3,
  rowCount: 12,
  error: "connector error",
  nextAt: 0,
  createdAt: "2026-11-09T00:00:00.000Z",
  updatedAt: "2026-11-09T03:00:00.000Z",
  createdBy: "admin",
  ...overrides,
});

it("finds missing observations only in terminal requested intervals", () => {
  const health = analyzeIngestionHealth(
    { ...baseStatus, jobs: [job()] },
    ["2026-11-09T00:00:00.000Z", "2026-11-09T02:00:00.000Z"],
    now,
  );
  expect(health.metrics.missingHours).toBe(1);
  expect(health.missingTimes).toEqual(["2026-11-09T01:00:00.000Z"]);
  expect(health.alerts.map((alert) => alert.code)).toContain(
    "missing_observations",
  );

  const queued = analyzeIngestionHealth(
    {
      ...baseStatus,
      lastSuccessAt: null,
      jobs: [job({ status: "queued", updatedAt: "2026-11-09T03:59:00.000Z" })],
    },
    [],
    now,
  );
  expect(queued.metrics.missingHours).toBe(0);
  expect(queued.metrics.pendingJobs).toBe(1);
});

it("reports completed-range holes, exhausted jobs and stale enabled schedules", () => {
  const health = analyzeIngestionHealth(
    {
      ...baseStatus,
      lastSuccessAt: null,
      schedule: { enabled: true, lastEnqueuedAt: "2026-11-09T01:00:00.000Z" },
      jobs: [job({ status: "succeeded" })],
    },
    ["2026-11-09T00:00:00.000Z"],
    now,
  );
  expect(health.metrics.missingHours).toBe(2);
  expect(health.metrics.failedJobs).toBe(0);
  expect(health.alerts.map((alert) => alert.code)).toEqual(
    expect.arrayContaining(["missing_observations", "schedule_stale"]),
  );

  const expiredHistory = analyzeIngestionHealth(
    {
      ...baseStatus,
      jobs: [
        job({
          status: "succeeded",
          startTime: "2026-09-01T00:00:00.000Z",
          endTime: "2026-09-01T02:00:00.000Z",
        }),
      ],
    },
    ["2026-11-09T00:00:00.000Z"],
    now,
  );
  expect(expiredHistory.metrics.missingHours).toBe(0);
});

it("alerts for failed jobs, overdue queue entries and expired worker leases", () => {
  const health = analyzeIngestionHealth(
    {
      ...baseStatus,
      jobs: [
        job(),
        job({
          id: "queued",
          status: "queued",
          createdAt: "2026-11-09T00:00:00.000Z",
          nextAt: 0,
        }),
        job({
          id: "running",
          status: "running",
          updatedAt: "2026-11-09T03:56:00.000Z",
        }),
      ],
    },
    [
      "2026-11-09T00:00:00.000Z",
      "2026-11-09T01:00:00.000Z",
      "2026-11-09T02:00:00.000Z",
    ],
    now,
  );
  expect(health.metrics).toMatchObject({
    failedJobs: 1,
    overdueJobs: 1,
    staleRunningJobs: 1,
    pendingJobs: 2,
  });
  expect(health.alerts.map((alert) => alert.code)).toEqual(
    expect.arrayContaining(["failed_jobs", "overdue_jobs", "stale_lease"]),
  );
});
