-- Migration 0008: Gmail integration (Slice C).
--
-- Stores OAuth tokens for the inquiries@stewardshipcre.com mailbox the agent
-- reads from + sends from. Adds a scheduled_acks queue for the 2–5 min
-- humanizing-delay auto-acknowledgments — the polling cron drains it.
--
-- Refresh tokens are plaintext for now (single-tenant, behind RLS scoped to
-- org). When we go multi-user, encrypt with Supabase Vault.

CREATE TABLE IF NOT EXISTS gmail_oauth_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  email           text NOT NULL,
  refresh_token   text NOT NULL,
  scopes          text[],
  last_history_id text,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  last_polled_at  timestamptz,
  poll_error      text,
  revoked_at      timestamptz,
  UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_gmail_tokens_org ON gmail_oauth_tokens (organization_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS scheduled_acks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id         uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  send_after      timestamptz NOT NULL,
  sent_at         timestamptz,
  error           text,
  attempts        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_acks_due ON scheduled_acks (send_after) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_scheduled_acks_lead ON scheduled_acks (lead_id);

ALTER TABLE gmail_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_acks      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gmail_oauth_tokens_anon_all ON gmail_oauth_tokens;
CREATE POLICY gmail_oauth_tokens_anon_all ON gmail_oauth_tokens FOR ALL TO anon
  USING (organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid);

DROP POLICY IF EXISTS scheduled_acks_anon_all ON scheduled_acks;
CREATE POLICY scheduled_acks_anon_all ON scheduled_acks FOR ALL TO anon
  USING (organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (organization_id = 'a0000000-0000-0000-0000-000000000001'::uuid);

COMMENT ON TABLE  gmail_oauth_tokens IS 'OAuth refresh tokens for Gmail mailboxes the agent reads/sends from.';
COMMENT ON COLUMN gmail_oauth_tokens.last_history_id IS 'Gmail history.list cursor — only pull messages newer than this.';
COMMENT ON TABLE  scheduled_acks     IS 'Pending auto-acknowledgments. Polling cron sends rows where send_after <= now and sent_at IS NULL.';
