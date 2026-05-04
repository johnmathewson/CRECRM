-- 0012_listing_metrics_crexi_native.sql
--
-- The CREXi seller dashboard surfaces three distinct view-stage metrics —
-- Impressions, Page Views, Unique Visitors — but our schema collapsed them
-- into a single `views` column. This migration breaks them out so the owner
-- dashboard can show where the funnel is leaking. We also add explicit
-- columns for `opened_oms` and `executed_cas` (previously stored in the
-- generic `downloads` / `nda_executions` columns).
--
-- The legacy generic columns (views/downloads/nda_executions) are kept
-- intact so LoopNet sync + older extension builds keep working. The owner
-- aggregator prefers the new specific columns when present and falls back
-- to the legacy ones otherwise.

ALTER TABLE listing_metrics
  ADD COLUMN IF NOT EXISTS impressions integer,
  ADD COLUMN IF NOT EXISTS page_views integer,
  ADD COLUMN IF NOT EXISTS unique_visitors integer,
  ADD COLUMN IF NOT EXISTS opened_oms integer,
  ADD COLUMN IF NOT EXISTS executed_cas integer;

COMMENT ON COLUMN listing_metrics.impressions IS
  'CREXi: search-result eyeballs. Top of funnel.';
COMMENT ON COLUMN listing_metrics.page_views IS
  'CREXi: clicked-into the listing detail page. Apples-to-apples with LoopNet "Page Views".';
COMMENT ON COLUMN listing_metrics.unique_visitors IS
  'CREXi: deduped page-view audience.';
COMMENT ON COLUMN listing_metrics.opened_oms IS
  'CREXi: viewers who clicked through to the OM. Prefers this over legacy `downloads`.';
COMMENT ON COLUMN listing_metrics.executed_cas IS
  'CREXi: viewers who signed the NDA. Prefers this over legacy `nda_executions`.';
