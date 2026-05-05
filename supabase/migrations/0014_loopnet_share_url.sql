-- 0014_loopnet_share_url.sql
--
-- LoopNet/CoStar shared performance report URL.
--
-- CoStar issues a "Share" link from the Listing Performance page that lets
-- anyone view the report without auth. The token in the URL ROTATES roughly
-- every 30 days, so this isn't set-and-forget — John needs to refresh it
-- monthly. We store the URL plus when it was last set so the UI can flag
-- "expires in N days" and prompt for refresh before it dies.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS loopnet_share_url text,
  ADD COLUMN IF NOT EXISTS loopnet_share_url_set_at timestamptz;

COMMENT ON COLUMN properties.loopnet_share_url IS
  'CoStar shared listing-performance-report URL. Public (no auth). Token rotates every ~30 days from CoStar Listing Manager.';
COMMENT ON COLUMN properties.loopnet_share_url_set_at IS
  'When the share URL was last refreshed. Compute expiry = set_at + 30 days; surface refresh prompt within 7 days of expiry.';
