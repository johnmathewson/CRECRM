-- 0016_owner_token_audience.sql
--
-- Phase 7 schema move: tag each magic link with its audience so the CRE OS
-- admin surface can split owner portals from investor portals. Investor
-- tokens point at deals/pursuits the buyer is tracking; owner tokens point
-- at listings the seller owns.
--
-- Default 'owner' covers all existing rows (everything created so far has
-- been an owner link). The check constraint pins the small enum.
--
-- Applied via Supabase MCP on 2026-05-07.

ALTER TABLE owner_access_tokens
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'owner';

ALTER TABLE owner_access_tokens
  DROP CONSTRAINT IF EXISTS owner_access_tokens_audience_check;

ALTER TABLE owner_access_tokens
  ADD CONSTRAINT owner_access_tokens_audience_check
  CHECK (audience IN ('owner','investor'));

CREATE INDEX IF NOT EXISTS idx_owner_tokens_audience
  ON owner_access_tokens (organization_id, audience, created_at DESC)
  WHERE revoked_at IS NULL;

COMMENT ON COLUMN owner_access_tokens.audience IS
  'owner = seller magic link to listing performance; investor = buyer/LP magic link to deal-flow / pursuit performance.';
