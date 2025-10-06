-- Optional multi-tenant fields and indexes for LR-HMM MCP
-- Apply only if you need per-user/org scoping in a shared DB

-- Conversations: scope columns
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS namespace TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_identity_id UUID;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS org_id TEXT;

-- Indexes for efficient filtering
CREATE INDEX IF NOT EXISTS conversations_namespace_idx ON conversations (namespace);
CREATE INDEX IF NOT EXISTS conversations_namespace_user_idx ON conversations (namespace, user_id);
CREATE INDEX IF NOT EXISTS conversations_namespace_identity_idx ON conversations (namespace, user_identity_id);
CREATE INDEX IF NOT EXISTS conversations_namespace_org_idx ON conversations (namespace, org_id);

-- (Optional) Provide a default namespace; keep NULL allowed based on your needs
ALTER TABLE conversations ALTER COLUMN namespace SET DEFAULT 'default';

-- (Optional) RLS example: only if your deployment exposes DB directly and you need per-namespace isolation at DB layer
-- ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY conversations_namespace_policy ON conversations
--   USING (namespace = current_setting('lr.namespace', true));
-- -- At session start: SET lr.namespace = 'acme-prod';

