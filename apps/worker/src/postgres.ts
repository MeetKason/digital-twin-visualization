import { Pool } from "pg";
import type { WeatherObservation } from "@dtv/contracts";
import type { ObservationStore } from "./index";
export class PostgresStore implements ObservationStore {
  constructor(private pool: Pool) {}
  async commit(rows: WeatherObservation[], watermark: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const r of rows)
        await client.query(
          `INSERT INTO weather_observation (tenant_id,station_id,observed_at,source,location,elements,quality,ingested_at) VALUES ('demo',$1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,$8) ON CONFLICT (tenant_id,station_id,observed_at,source) DO UPDATE SET elements=EXCLUDED.elements,quality=EXCLUDED.quality,ingested_at=EXCLUDED.ingested_at`,
          [
            r.stationId,
            r.observedAt,
            r.source,
            r.location.lon,
            r.location.lat,
            JSON.stringify(r.elements),
            JSON.stringify(r.quality),
            r.ingestedAt,
          ],
        );
      await client.query(
        `INSERT INTO ingest_job(id,watermark,status) VALUES ('mock-xian',$1,'ok') ON CONFLICT(id) DO UPDATE SET watermark=GREATEST(ingest_job.watermark,EXCLUDED.watermark),status='ok',updated_at=now()`,
        [watermark],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
