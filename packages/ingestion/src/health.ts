import type { IngestionHealth, IngestionStatus } from "@dtv/contracts";
import { HOUR, LEASE_MS } from "./state";

const PENDING = new Set(["queued", "running", "retrying"]);
const TERMINAL = new Set(["succeeded", "failed"]);
const OVERDUE_MS = 15 * 60_000;
const SCHEDULE_STALE_MS = 2 * HOUR;

export function analyzeIngestionHealth(
  status: IngestionStatus,
  observedTimes: string[],
  now = Date.now(),
): IngestionHealth {
  // 切换地区来源后，只统计当前来源的任务，避免把旧源历史当成新源告警。
  const jobs = status.jobs.filter((job) => job.source === status.source);
  const pendingJobs = jobs.filter((job) =>
    PENDING.has(job.status),
  ).length;
  const failedJobs = jobs.filter(
    (job) => job.status === "failed",
  ).length;
  const overdueJobs = jobs.filter(
    (job) =>
      ["queued", "retrying"].includes(job.status) &&
      job.nextAt <= now &&
      now - Date.parse(job.createdAt) >= OVERDUE_MS,
  ).length;
  const staleRunningJobs = jobs.filter(
    (job) =>
      job.status === "running" && now - Date.parse(job.updatedAt) >= LEASE_MS,
  ).length;
  const available = new Set(
    observedTimes.map((time) => Date.parse(time)).filter(Number.isFinite),
  );
  // Both stores retain at most 1000 distinct observation times. Do not label
  // older successfully processed hours as missing after retention expires.
  const retentionStart = available.size
    ? Math.min(...available)
    : now - 1000 * HOUR;
  const expected = new Set<number>();
  for (const job of jobs) {
    if (!TERMINAL.has(job.status)) continue;
    const start = Math.max(Date.parse(job.startTime), retentionStart);
    const end = Date.parse(job.endTime);
    for (
      let hour = start;
      Number.isFinite(hour) && hour <= end && hour - start <= 168 * HOUR;
      hour += HOUR
    )
      expected.add(hour);
  }
  const missing = [...expected]
    .filter((time) => !available.has(time))
    .sort((a, b) => a - b);
  const scheduleAnchor = status.lastSuccessAt ?? status.schedule.lastEnqueuedAt;
  const scheduleAge = scheduleAnchor ? now - Date.parse(scheduleAnchor) : 0;
  const scheduleStale =
    status.schedule.enabled && scheduleAge >= SCHEDULE_STALE_MS;
  const alerts: IngestionHealth["alerts"] = [];
  if (failedJobs)
    alerts.push({
      code: "failed_jobs",
      severity: "critical",
      count: failedJobs,
      message: `${failedJobs} 个采集任务最终失败`,
    });
  if (missing.length)
    alerts.push({
      code: "missing_observations",
      severity: "critical",
      count: missing.length,
      message: `${missing.length} 个已结束任务时次没有观测记录`,
    });
  if (overdueJobs)
    alerts.push({
      code: "overdue_jobs",
      severity: "warning",
      count: overdueJobs,
      message: `${overdueJobs} 个待执行任务超过 15 分钟`,
    });
  if (staleRunningJobs)
    alerts.push({
      code: "stale_lease",
      severity: "warning",
      count: staleRunningJobs,
      message: `${staleRunningJobs} 个运行任务的租约超过 2 分钟未更新`,
    });
  if (scheduleStale)
    alerts.push({
      code: "schedule_stale",
      severity: "warning",
      count: 1,
      message: "定时采集已超过 2 小时没有成功时次",
    });
  return {
    source: status.source,
    checkedAt: new Date(now).toISOString(),
    metrics: {
      pendingJobs,
      failedJobs,
      overdueJobs,
      staleRunningJobs,
      missingHours: missing.length,
      totalRows: jobs.reduce((sum, job) => sum + job.rowCount, 0),
    },
    missingTimes: missing
      .slice(0, 168)
      .map((time) => new Date(time).toISOString()),
    alerts,
  };
}
