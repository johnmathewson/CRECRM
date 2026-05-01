-- CREXi seller dashboard surfaces deeper-funnel signals than impressions/saves.
-- Add columns for NDAs executed (Executed CAs) and offers received.
ALTER TABLE listing_metrics
  ADD COLUMN IF NOT EXISTS nda_executions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offers integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN listing_metrics.nda_executions IS 'NDAs / Confidentiality Agreements signed (CREXi: Executed CAs)';
COMMENT ON COLUMN listing_metrics.offers IS 'Offers received on this listing (CREXi: Offers)';
COMMENT ON COLUMN listing_metrics.downloads IS 'OMs opened/downloaded (CREXi: Opened OMs)';
COMMENT ON COLUMN listing_metrics.inquiries IS 'Leads received (CREXi: Leads)';
