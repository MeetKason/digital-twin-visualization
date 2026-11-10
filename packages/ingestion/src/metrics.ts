export interface IngestionMetricSnapshot {
  jobs: { source: string; status: string; count: number }[];
  enabledSchedules: number;
}

const sources = new Set(["mock", "tianqing"]);
const statuses = new Set([
  "queued", "running", "retrying", "succeeded", "failed", "cancelled",
]);
const count = (value: number) =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0;

/** 只导出固定维度计数，避免把租户、站点、凭据或 endpoint 放入指标标签。 */
export function renderIngestionMetrics(snapshot: IngestionMetricSnapshot) {
  const lines = [
    "# HELP dtv_ingestion_jobs Ingestion jobs grouped by source and state",
    "# TYPE dtv_ingestion_jobs gauge",
  ];
  for (const job of snapshot.jobs) {
    if (!sources.has(job.source) || !statuses.has(job.status)) continue;
    lines.push(
      `dtv_ingestion_jobs{source="${job.source}",status="${job.status}"} ${count(job.count)}`,
    );
  }
  lines.push(
    "# HELP dtv_ingestion_schedules_enabled Number of enabled scene schedules",
    "# TYPE dtv_ingestion_schedules_enabled gauge",
    `dtv_ingestion_schedules_enabled ${count(snapshot.enabledSchedules)}`,
  );
  return `${lines.join("\n")}\n`;
}
