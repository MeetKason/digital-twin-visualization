import { z } from "zod";
export const hourlyTime = z.iso
  .datetime({ offset: true })
  .refine((s) => Date.parse(s) % 3600000 === 0, "必须是带时区的整点时次")
  .transform((s) => new Date(s).toISOString());
export const ingestionRequest = z
  .object({
    source: z.enum(["mock", "tianqing"]),
    // 缺省值兼容旧版 API 客户端和历史任务。
    productId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).default("surface-hourly"),
    startTime: hourlyTime,
    endTime: hourlyTime,
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.endTime) >= Date.parse(v.startTime) &&
      Date.parse(v.endTime) - Date.parse(v.startTime) < 168 * 3600000,
    "补数范围须为1至168个小时",
  );
export type IngestionRequest = z.input<typeof ingestionRequest>;
export type JobStatus =
  | "queued"
  | "running"
  | "retrying"
  | "succeeded"
  | "failed"
  | "cancelled";
export interface IngestionJob {
  id: string;
  productId: string;
  source: "mock" | "tianqing";
  kind: "manual" | "scheduled";
  startTime: string;
  endTime: string;
  cursor: string;
  status: JobStatus;
  attempts: number;
  completedHours: number;
  totalHours: number;
  rowCount: number;
  error: string | null;
  nextAt: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}
export interface IngestionStatus {
  productId: string;
  source: "mock" | "tianqing";
  mode: "demo" | "ingested";
  watermark: string | null;
  lastSuccessAt: string | null;
  schedule: { enabled: boolean; lastEnqueuedAt: string | null };
  jobs: IngestionJob[];
}
export const observationSchema = z.object({
  source: z.enum(["mock", "tianqing", "other"]),
  stationId: z.string().min(1).max(100),
  observedAt: z.iso.datetime({ offset: true }),
  ingestedAt: z.iso.datetime({ offset: true }),
  location: z.object({
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    crs: z.literal("EPSG:4326"),
  }),
  elements: z.object({
    temperatureC: z.number().min(-100).max(70).nullable(),
    rainfallMm: z.number().min(0).max(3000).nullable(),
    windSpeedMs: z.number().min(0).max(150).nullable(),
    radarDbz: z.number().min(0).max(70).nullable().optional(),
    cloudPercent: z.number().min(0).max(100).nullable().optional(),
    windFieldMs: z.number().min(0).max(80).nullable().optional(),
    relativeHumidity: z.number().min(0).max(100).nullable().optional(),
    forecastTempC: z.number().min(-80).max(60).nullable().optional(),
    gridValue: z.number().min(0).max(100).nullable().optional(),
    warningLevel: z.number().min(0).max(4).nullable().optional(),
    simulationIntensity: z.number().min(0).max(100).nullable().optional(),
  }),
  quality: z.record(z.string(), z.string()),
});

export interface IngestionHealthAlert {
  code:
    | "failed_jobs"
    | "missing_observations"
    | "overdue_jobs"
    | "stale_lease"
    | "schedule_stale";
  severity: "warning" | "critical";
  count: number;
  message: string;
}
export interface IngestionHealth {
  source: "mock" | "tianqing";
  checkedAt: string;
  metrics: {
    pendingJobs: number;
    failedJobs: number;
    overdueJobs: number;
    staleRunningJobs: number;
    missingHours: number;
    totalRows: number;
  };
  missingTimes: string[];
  alerts: IngestionHealthAlert[];
}
