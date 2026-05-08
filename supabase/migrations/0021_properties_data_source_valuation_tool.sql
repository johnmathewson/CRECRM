-- 0021_properties_data_source_valuation_tool.sql
--
-- Widen properties.data_source check constraint to accept 'valuation_tool',
-- which is what /api/valuate/save tags BOV-derived properties with. The
-- old constraint only allowed 'proprietary' | 'public_record' | 'third_party',
-- which silently 500'd every Convert-to-Property click from the BOV flow.
--
-- Applied via Supabase MCP on 2026-05-07 during diagnostic test.

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_data_source_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_data_source_check
  CHECK (data_source = ANY (ARRAY[
    'proprietary'::text,
    'public_record'::text,
    'third_party'::text,
    'valuation_tool'::text
  ]));
