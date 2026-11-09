BEGIN;
ALTER TABLE weather_observation ADD COLUMN IF NOT EXISTS scene_id text NOT NULL DEFAULT 'xian';
ALTER TABLE weather_observation DROP CONSTRAINT IF EXISTS weather_observation_pkey;
ALTER TABLE weather_observation ADD CONSTRAINT weather_observation_pkey PRIMARY KEY (tenant_id,scene_id,station_id,observed_at,source);
CREATE INDEX IF NOT EXISTS observation_scope_time_idx ON weather_observation(tenant_id,scene_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS ingestion_state (
 tenant_id text NOT NULL,
 scene_id text NOT NULL,
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,scene_id)
);
COMMIT;
