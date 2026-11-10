BEGIN;
-- 旧观测和队列默认归入地面小时产品，确保升级后查询连续。
ALTER TABLE weather_observation ADD COLUMN IF NOT EXISTS product_id text NOT NULL DEFAULT 'surface-hourly';
ALTER TABLE weather_observation DROP CONSTRAINT IF EXISTS weather_observation_pkey;
ALTER TABLE weather_observation ADD CONSTRAINT weather_observation_pkey PRIMARY KEY (tenant_id,scene_id,product_id,station_id,observed_at,source);
CREATE INDEX IF NOT EXISTS observation_product_time_idx ON weather_observation(tenant_id,scene_id,product_id,observed_at DESC);
UPDATE ingestion_state
SET state = jsonb_set(
  jsonb_set(
    jsonb_set(COALESCE(state,'{}'::jsonb), '{productId}', '"surface-hourly"'::jsonb, true),
    '{productSchedules}', COALESCE(state->'productSchedules','{}'::jsonb), true
  ),
  '{productProgress}', COALESCE(state->'productProgress','{}'::jsonb), true
)
WHERE NOT (state ? 'productId' AND state ? 'productSchedules' AND state ? 'productProgress');
UPDATE ingestion_state
SET state = jsonb_set(state, '{jobs}', COALESCE((
  SELECT jsonb_agg(CASE WHEN job ? 'productId' THEN job ELSE jsonb_set(job,'{productId}','"surface-hourly"'::jsonb,true) END)
  FROM jsonb_array_elements(COALESCE(state->'jobs','[]'::jsonb)) AS job
), '[]'::jsonb), true)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(state->'jobs','[]'::jsonb)) AS job WHERE NOT job ? 'productId');
COMMIT;
