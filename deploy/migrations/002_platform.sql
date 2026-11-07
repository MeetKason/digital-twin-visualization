CREATE TABLE IF NOT EXISTS scene_business(tenant_id text NOT NULL,scene_id text NOT NULL,revision integer NOT NULL CHECK(revision>0),data jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,scene_id));
CREATE TABLE IF NOT EXISTS platform_session(token_hash text PRIMARY KEY,data jsonb NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS platform_session_expiry_idx ON platform_session(expires_at);
CREATE TABLE IF NOT EXISTS platform_audit(id uuid PRIMARY KEY,tenant_id text NOT NULL,actor text NOT NULL,scene_id text NOT NULL,action text NOT NULL,result text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS platform_audit_tenant_idx ON platform_audit(tenant_id,created_at DESC);
