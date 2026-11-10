import type { Pool } from "pg";
import type { WeatherObservation } from "@dtv/contracts";
import {
  IngestionStore,
  newScope,
  scopeKey,
  type ScopeState,
  type IngestionSource,
  type States,
  type WriteRows,
} from "./state";
import type { IngestionProduct } from "./products";
export class PostgresIngestionStore extends IngestionStore {
  constructor(
    private readonly pool: Pool,
    resolveSource: (sceneId: string, productId?: string) => IngestionSource = () => "mock",
    products?: IngestionProduct[],
  ) {
    super(resolveSource, products);
  }
  override async metricsSnapshot() {
    const [jobs, schedules] = await Promise.all([
      this.pool.query<{ source: string; status: string; count: number }>(
        `SELECT job->>'source' AS source,job->>'status' AS status,COUNT(*)::int AS count
         FROM ingestion_state CROSS JOIN LATERAL jsonb_array_elements(COALESCE(state->'jobs','[]'::jsonb)) AS item(job)
         GROUP BY job->>'source',job->>'status'`,
      ),
      this.pool.query<{ count: number }>(
        "SELECT COALESCE(SUM((state->'schedule'->>'enabled'='true')::int + (SELECT COUNT(*)::int FROM jsonb_each(COALESCE(state->'productSchedules','{}'::jsonb)) AS s WHERE s.value->>'enabled'='true')),0)::int AS count FROM ingestion_state",
      ),
    ]);
    return {
      jobs: jobs.rows,
      enabledSchedules: schedules.rows[0]?.count ?? 0,
    };
  }
  /** 将队列状态、观测行和进度水位放在同一数据库事务提交。 */
  protected async transaction<T>(
    scope: [string, string] | null,
    work: (states: States, write: WriteRows, clock: number) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (scope)
        await client.query(
          "INSERT INTO ingestion_state(tenant_id,scene_id,state) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [...scope, JSON.stringify(newScope(...scope))],
        );
      const result = scope
        ? await client.query<{ state: ScopeState }>(
            "SELECT state FROM ingestion_state WHERE tenant_id=$1 AND scene_id=$2 FOR UPDATE",
            scope,
          )
        : await client.query<{ state: ScopeState }>(
            "SELECT state FROM ingestion_state WHERE state->'schedule'->>'enabled'='true' OR EXISTS(SELECT 1 FROM jsonb_each(COALESCE(state->'productSchedules','{}'::jsonb)) AS s WHERE s.value->>'enabled'='true') OR EXISTS(SELECT 1 FROM jsonb_array_elements(state->'jobs') AS j WHERE j->>'status' IN ('queued','running','retrying')) ORDER BY updated_at FOR UPDATE SKIP LOCKED",
          );
      const states: States = Object.fromEntries(
        result.rows.map((r) => [
          scopeKey(r.state.tenantId, r.state.sceneId),
          r.state,
        ]),
      );
      const before = new Map(
        Object.entries(states).map(([key, state]) => [
          key,
          JSON.stringify(state),
        ]),
      );
      const clock = (
        await client.query<{ now: Date }>("SELECT clock_timestamp() AS now")
      ).rows[0].now.getTime();
      const value = await work(
        states,
        async (state, rows, productId) => {
          for (const row of rows)
            await client.query(
              `INSERT INTO weather_observation(tenant_id,scene_id,product_id,station_id,observed_at,source,location,elements,quality,ingested_at)
          VALUES($1,$2,$3,$4,$5,$6,ST_SetSRID(ST_MakePoint($7,$8),4326),$9,$10,$11)
          ON CONFLICT(tenant_id,scene_id,product_id,station_id,observed_at,source) DO UPDATE SET location=EXCLUDED.location,elements=EXCLUDED.elements,quality=EXCLUDED.quality,ingested_at=EXCLUDED.ingested_at`,
              [
                state.tenantId,
                state.sceneId,
                productId,
                row.stationId,
                row.observedAt,
                row.source,
                row.location.lon,
                row.location.lat,
                JSON.stringify(row.elements),
                JSON.stringify(row.quality),
                row.ingestedAt,
              ],
            );
        },
        clock,
      );
      for (const [key, state] of Object.entries(states)) {
        const json = JSON.stringify(state);
        if (json !== before.get(key))
          await client.query(
            "UPDATE ingestion_state SET state=$3,updated_at=now() WHERE tenant_id=$1 AND scene_id=$2",
            [state.tenantId, state.sceneId, json],
          );
      }
      await client.query("COMMIT");
      return value;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  override async times(tenant: string, scene: string, productId = "surface-hourly") {
    const result = await this.pool.query<{ observed_at: Date }>(
      "SELECT DISTINCT observed_at FROM weather_observation WHERE tenant_id=$1 AND scene_id=$2 AND product_id=$3 AND source=$4 ORDER BY observed_at DESC LIMIT 1000",
      [tenant, scene, productId, this.sourceForScene(scene, productId)],
    );
    return result.rows.map((r) => r.observed_at.toISOString()).reverse();
  }
  override async observations(
    tenant: string,
    scene: string,
    time: string,
    productId = "surface-hourly",
  ): Promise<WeatherObservation[]> {
    const result = await this.pool.query<{
      station_id: string;
      observed_at: Date;
      ingested_at: Date;
      lon: number;
      lat: number;
      elements: WeatherObservation["elements"];
      quality: WeatherObservation["quality"];
    }>(
      `SELECT station_id,observed_at,ingested_at,ST_X(location) AS lon,ST_Y(location) AS lat,elements,quality FROM weather_observation WHERE tenant_id=$1 AND scene_id=$2 AND product_id=$3 AND observed_at=$4 AND source=$5 ORDER BY station_id`,
      [tenant, scene, productId, time, this.sourceForScene(scene, productId)],
    );
    return result.rows.map((r) => ({
      source: this.sourceForScene(scene, productId),
      stationId: r.station_id,
      observedAt: r.observed_at.toISOString(),
      ingestedAt: r.ingested_at.toISOString(),
      location: { lon: r.lon, lat: r.lat, crs: "EPSG:4326" },
      elements: r.elements,
      quality: r.quality,
    }));
  }
}
