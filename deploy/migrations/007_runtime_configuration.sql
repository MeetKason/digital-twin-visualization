-- 场景等声明式运行配置独立保存，不覆盖业务实体或观测；修订号用于并发校验。
CREATE TABLE IF NOT EXISTS platform_configuration (
  tenant_id text NOT NULL,
  config_key text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, config_key)
);
