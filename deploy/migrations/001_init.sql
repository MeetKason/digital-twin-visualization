CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS weather_observation (
 tenant_id text NOT NULL,
 station_id text NOT NULL,
 observed_at timestamptz NOT NULL,
 source text NOT NULL,
 location geometry(Point,4326) NOT NULL,
 elements jsonb NOT NULL,
 quality jsonb NOT NULL,
 ingested_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,station_id,observed_at,source)
);
CREATE INDEX IF NOT EXISTS observation_location_idx ON weather_observation USING gist(location);
CREATE INDEX IF NOT EXISTS observation_time_idx ON weather_observation(tenant_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS ingest_job(id text PRIMARY KEY,watermark timestamptz,status text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
