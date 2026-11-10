BEGIN;

ALTER TABLE scene_publication
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending_approval'
    CHECK (approval_status IN ('pending_approval','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS rejected_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

CREATE TABLE IF NOT EXISTS scene_active_publication (
  tenant_id text NOT NULL,
  scene_id text NOT NULL,
  revision integer NOT NULL,
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  traffic_percent integer NOT NULL DEFAULT 100 CHECK (traffic_percent BETWEEN 1 AND 100),
  previous_revision integer,
  PRIMARY KEY (tenant_id, scene_id),
  FOREIGN KEY (tenant_id, scene_id, revision)
    REFERENCES scene_publication(tenant_id, scene_id, revision)
);
ALTER TABLE scene_active_publication ADD COLUMN IF NOT EXISTS previous_revision integer;

COMMIT;
