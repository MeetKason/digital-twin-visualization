BEGIN;
CREATE TABLE IF NOT EXISTS scene_station (
 tenant_id text NOT NULL,
 scene_id text NOT NULL,
 station_id text NOT NULL,
 name text NOT NULL,
 station_type text NOT NULL DEFAULT '',
 longitude double precision NOT NULL,
 latitude double precision NOT NULL,
 elevation_m double precision NOT NULL DEFAULT 0,
 data jsonb NOT NULL,
 PRIMARY KEY (tenant_id,scene_id,station_id)
);
CREATE INDEX IF NOT EXISTS scene_station_location_idx ON scene_station(scene_id,longitude,latitude);
CREATE TABLE IF NOT EXISTS scene_asset (
 tenant_id text NOT NULL,
 scene_id text NOT NULL,
 asset_id text NOT NULL,
 name text NOT NULL,
 kind text NOT NULL,
 blob_id text NOT NULL,
 file_name text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
 station_id text,
 data jsonb NOT NULL,
 PRIMARY KEY (tenant_id,scene_id,asset_id)
);
CREATE INDEX IF NOT EXISTS scene_asset_blob_idx ON scene_asset(tenant_id,scene_id,blob_id);
CREATE TABLE IF NOT EXISTS scene_bookmark (
 tenant_id text NOT NULL,
 scene_id text NOT NULL,
 bookmark_id text NOT NULL,
 name text NOT NULL,
 view jsonb NOT NULL,
 data jsonb NOT NULL,
 PRIMARY KEY (tenant_id,scene_id,bookmark_id)
);
CREATE TABLE IF NOT EXISTS scene_cruise_plan (
 tenant_id text NOT NULL,
 scene_id text NOT NULL,
 plan_id text NOT NULL,
 name text NOT NULL,
 saved boolean NOT NULL DEFAULT false,
 data jsonb NOT NULL,
 PRIMARY KEY (tenant_id,scene_id,plan_id)
);
CREATE TABLE IF NOT EXISTS scene_cruise_point (
 tenant_id text NOT NULL,
 scene_id text NOT NULL,
 plan_id text NOT NULL,
 point_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal > 0),
 name text NOT NULL,
 longitude double precision NOT NULL,
 latitude double precision NOT NULL,
 height_m double precision NOT NULL,
 model_id text,
 bookmark_id text,
 data jsonb NOT NULL,
 PRIMARY KEY (tenant_id,scene_id,plan_id,point_id),
 UNIQUE (tenant_id,scene_id,plan_id,ordinal)
);
CREATE INDEX IF NOT EXISTS scene_cruise_point_model_idx ON scene_cruise_point(tenant_id,scene_id,model_id);
CREATE TABLE IF NOT EXISTS scene_publication (
 id uuid PRIMARY KEY,
 tenant_id text NOT NULL,
 scene_id text NOT NULL,
 revision integer NOT NULL CHECK(revision > 0),
 publisher text NOT NULL,
 message text NOT NULL DEFAULT '',
 snapshot jsonb NOT NULL,
 published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (tenant_id,scene_id,revision)
);
CREATE INDEX IF NOT EXISTS scene_publication_scope_idx ON scene_publication(tenant_id,scene_id,published_at DESC);

-- Backfill existing JSONB business state into typed tenant-scoped entity projections.
INSERT INTO scene_station(tenant_id,scene_id,station_id,name,station_type,longitude,latitude,elevation_m,data)
SELECT b.tenant_id,b.scene_id,e.value->>'id',e.value->>'name',COALESCE(e.value->>'type',''),(e.value->>'lon')::double precision,(e.value->>'lat')::double precision,COALESCE((e.value->>'elevationM')::double precision,0),e.value
FROM scene_business b CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.data->'stations','[]'::jsonb)) e(value)
ON CONFLICT(tenant_id,scene_id,station_id) DO UPDATE SET name=EXCLUDED.name,station_type=EXCLUDED.station_type,longitude=EXCLUDED.longitude,latitude=EXCLUDED.latitude,elevation_m=EXCLUDED.elevation_m,data=EXCLUDED.data;
INSERT INTO scene_asset(tenant_id,scene_id,asset_id,name,kind,blob_id,file_name,size_bytes,station_id,data)
SELECT b.tenant_id,b.scene_id,e.value->>'id',e.value->>'name',e.value->>'kind',e.value->>'blobId',e.value->>'fileName',(e.value->>'size')::bigint,e.value->>'stationId',e.value
FROM scene_business b CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.data->'assets','[]'::jsonb)) e(value)
ON CONFLICT(tenant_id,scene_id,asset_id) DO UPDATE SET name=EXCLUDED.name,kind=EXCLUDED.kind,blob_id=EXCLUDED.blob_id,file_name=EXCLUDED.file_name,size_bytes=EXCLUDED.size_bytes,station_id=EXCLUDED.station_id,data=EXCLUDED.data;
INSERT INTO scene_bookmark(tenant_id,scene_id,bookmark_id,name,view,data)
SELECT b.tenant_id,b.scene_id,e.value->>'id',e.value->>'name',e.value->'view',e.value
FROM scene_business b CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.data->'bookmarks','[]'::jsonb)) e(value)
ON CONFLICT(tenant_id,scene_id,bookmark_id) DO UPDATE SET name=EXCLUDED.name,view=EXCLUDED.view,data=EXCLUDED.data;
INSERT INTO scene_cruise_plan(tenant_id,scene_id,plan_id,name,saved,data)
SELECT b.tenant_id,b.scene_id,p.value->>'id',p.value->>'name',COALESCE((p.value->>'saved')::boolean,false),p.value
FROM scene_business b CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.data->'plans','[]'::jsonb)) p(value)
ON CONFLICT(tenant_id,scene_id,plan_id) DO UPDATE SET name=EXCLUDED.name,saved=EXCLUDED.saved,data=EXCLUDED.data;
INSERT INTO scene_cruise_point(tenant_id,scene_id,plan_id,point_id,ordinal,name,longitude,latitude,height_m,model_id,bookmark_id,data)
SELECT b.tenant_id,b.scene_id,p.value->>'id',point.value->>'id',point.ordinality::integer,point.value->>'name',(point.value->>'lon')::double precision,(point.value->>'lat')::double precision,(point.value->>'height')::double precision,point.value->>'modelId',point.value->>'bookmarkId',point.value
FROM scene_business b
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(b.data->'plans','[]'::jsonb)) p(value)
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.value->'points','[]'::jsonb)) WITH ORDINALITY point(value,ordinality)
ON CONFLICT(tenant_id,scene_id,plan_id,point_id) DO UPDATE SET ordinal=EXCLUDED.ordinal,name=EXCLUDED.name,longitude=EXCLUDED.longitude,latitude=EXCLUDED.latitude,height_m=EXCLUDED.height_m,model_id=EXCLUDED.model_id,bookmark_id=EXCLUDED.bookmark_id,data=EXCLUDED.data;
COMMIT;
