-- 0025_prospector_constraint_alignment.sql
--
-- Six constraint mismatches surfaced during the first real Prospector
-- import run. Same diagnostic pattern as migration 0023 — code emits
-- values the existing CHECK constraints reject. Widening rather than
-- mapping so signals stay granular and queryable in lane filters.
--
-- Applied via Supabase MCP on 2026-05-09.

-- properties.data_source — accept the import sources directly
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_data_source_check;
ALTER TABLE properties ADD CONSTRAINT properties_data_source_check
  CHECK (data_source = ANY (ARRAY[
    'proprietary'::text, 'public_record'::text, 'third_party'::text,
    'valuation_tool'::text, 'costar'::text, 'propstream'::text
  ]));

-- properties.asset_type — add self_storage + special_use (the
-- normalizeAssetType helper produces these for storage and specialty
-- properties; mapping them to 'other' would lose the lane filter signal)
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_asset_type_check;
ALTER TABLE properties ADD CONSTRAINT properties_asset_type_check
  CHECK (asset_type = ANY (ARRAY[
    'retail'::text, 'office'::text, 'industrial'::text, 'hospitality'::text,
    'multifamily'::text, 'land'::text, 'medical'::text, 'mixed_use'::text,
    'self_storage'::text, 'special_use'::text, 'other'::text
  ]));

-- import_jobs.source — add costar + propstream
ALTER TABLE import_jobs DROP CONSTRAINT IF EXISTS import_jobs_source_check;
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_source_check
  CHECK (source = ANY (ARRAY[
    'csv_upload'::text, 'attom_api'::text, 'county_gis'::text,
    'county_assessor'::text, 'compstak'::text, 'manual'::text,
    'nylas'::text, 'costar'::text, 'propstream'::text, 'other'::text
  ]));

-- signals.signal_type — extend taxonomy with the prospector flags so we
-- can store one signals row per derived flag instead of mashing them
-- all into 'custom'.
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_signal_type_check;
ALTER TABLE signals ADD CONSTRAINT signals_signal_type_check
  CHECK (signal_type = ANY (ARRAY[
    'ownership_change'::text, 'assessment_spike'::text, 'vacancy_detected'::text,
    'lease_expiry_approaching'::text, 'debt_maturity'::text, 'permit_filed'::text,
    'code_violation'::text, 'tax_delinquent'::text, 'estate_probate'::text,
    'portfolio_shift'::text, 'price_reduction'::text, 'days_on_market'::text,
    'demand_match'::text, 'custom'::text,
    -- Prospector additions
    'pre_foreclosure'::text, 'lis_pendens'::text, 'notice_of_default'::text,
    'notice_of_trustee_sale'::text, 'sheriff_sale'::text, 'reo'::text,
    'refi_maturing_12mo'::text, 'refi_maturing_24mo'::text, 'refi_maturing_36mo'::text,
    'long_hold_15plus'::text, 'long_hold_20plus'::text, 'absentee_owner'::text
  ]));

-- signals.data_source — let prospector signals tag their source distinctly
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_data_source_check;
ALTER TABLE signals ADD CONSTRAINT signals_data_source_check
  CHECK (data_source = ANY (ARRAY[
    'proprietary'::text, 'public_record'::text, 'third_party'::text,
    'derived'::text, 'manual'::text, 'propstream'::text, 'costar'::text
  ]));

-- Note: the import_jobs.status enum already had the right values
-- (pending | processing | completed | failed | partial); the import code
-- was using the wrong literals ('running' / 'complete'). Fixed in the
-- application code rather than the DB.
