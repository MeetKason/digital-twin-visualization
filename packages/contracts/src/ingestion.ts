import { z } from "zod";
export const hourlyTime = z.iso
  .datetime({ offset: true })
  .refine((s) => Date.parse(s) % 3600000 === 0, "必须是带时区的整点时次")
  .transform((s) => new Date(s).toISOString());
export const ingestionRequest = z
  .object({
    source: z.literal("mock"),
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
  source: "mock";
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
  source: "mock";
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
  }),
  quality: z.record(z.string(), z.string()),
});
