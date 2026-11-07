import type { WeatherObservation } from "@dtv/contracts";
import { demoObservations, SceneSchema } from "@dtv/contracts";
import xian from "../../../scenarios/xian.json";
export interface Connector {
  fetch(time: string): Promise<WeatherObservation[]>;
}
export interface ObservationStore {
  commit(rows: WeatherObservation[], watermark: string): Promise<void>;
}
export class MockConnector implements Connector {
  async fetch(time: string) {
    return demoObservations(SceneSchema.parse(xian), time);
  }
}
export class MemoryStore implements ObservationStore {
  rows = new Map<string, WeatherObservation>();
  watermark: string | null = null;
  failNext = false;
  async commit(rows: WeatherObservation[], watermark: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("模拟持久化失败");
    }
    for (const row of rows)
      this.rows.set(`${row.source}:${row.stationId}:${row.observedAt}`, row);
    this.watermark = watermark;
  }
}
export class IngestRunner {
  constructor(
    private connector: Connector,
    private store: ObservationStore,
  ) {}
  async run(time: string) {
    if (!Number.isFinite(Date.parse(time))) throw new Error("无效时次");
    const rows = await this.connector.fetch(time);
    for (const row of rows) {
      if (
        !row.stationId ||
        row.observedAt !== time ||
        !Number.isFinite(row.location.lon) ||
        !Number.isFinite(row.location.lat) ||
        Math.abs(row.location.lon) > 180 ||
        Math.abs(row.location.lat) > 90
      )
        throw new Error("观测契约校验失败");
    }
    await this.store.commit(rows, time);
    return rows.length;
  }
}
