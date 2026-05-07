-- 0019_seller_net_offers_publish.sql
--
-- Splits seller-net offers into draft (admin-only) and published
-- (visible on the owner portal). Existing rows were all created from
-- the owner-portal flow before this column existed, so they're
-- backfilled as published-on-creation.
--
-- Applied via Supabase MCP on 2026-05-07.

ALTER TABLE seller_net_offers
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE seller_net_offers
SET published_at = created_at
WHERE created_via_token_id IS NOT NULL
  AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_seller_net_offers_published
  ON seller_net_offers (property_id, published_at DESC)
  WHERE published_at IS NOT NULL;

COMMENT ON COLUMN seller_net_offers.published_at IS
  'NULL = internal draft (CRE OS admin only). Non-null = visible on /api/public/owner/[token].';
