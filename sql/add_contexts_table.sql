CREATE TABLE IF NOT EXISTS contexts (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  slug TEXT NOT NULL,
  query TEXT NOT NULL,
  params_json JSONB,
  items_json JSONB,
  expanded_json JSONB,
  budget_json JSONB,
  metrics_json JSONB
);
CREATE INDEX IF NOT EXISTS contexts_slug_idx ON contexts (slug);

