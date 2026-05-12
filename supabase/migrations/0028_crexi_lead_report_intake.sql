-- 0028_crexi_lead_report_intake.sql
--
-- Two small DB changes to let the CREXi daily Lead Report parser write
-- to existing tables.
--
-- Applied via Supabase MCP on 2026-05-12.

-- 1. import_jobs.source needs to accept 'crexi_lead_report' so each
--    parsed report gets a proper audit row.
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_source_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_source_check
  CHECK (source = ANY (ARRAY[
    'csv_upload','attom_api','county_gis','county_assessor','compstak',
    'manual','nylas','costar','propstream','crexi_lead_report','other'
  ]));

-- 2. crexi_leads_state.crexi_listing_id was NOT NULL because the original
--    Chrome-extension writer derives it from CREXi's URL. The new XLSX
--    parser doesn't have that field (CREXi doesn't include it in the
--    report) — it works off property match + email. Drop NOT NULL so
--    the parser can insert rows.
ALTER TABLE crexi_leads_state ALTER COLUMN crexi_listing_id DROP NOT NULL;
