-- 0022_properties_status_widen.sql
--
-- Phase 8 introduced a richer property-status ladder in the UI helpers
-- (idea, prospecting, pitched, listed, under_contract, leased, sold,
-- closed, dead) but the DB check constraint was the original short set
-- and silently rejected any of the new values. Symptoms:
--   • Add Property dialog 500'd when user picked Prospecting / Pitched /
--     Closed / Dead.
--   • StatusEditor popover 500'd on the same picks.
--   • Mark-deal-dead from deal workspace 500'd because it sets
--     property.status='dead'.
--   • /api/valuate/save 500'd because the BOV path now uses 'prospecting'
--     as its default status.
-- Discovered during diagnostic test of the Convert-to-Property flow.
--
-- Widen the constraint to accept the full ladder + the legacy values that
-- predate Phase 8 (so existing data continues to validate).
--
-- Applied via Supabase MCP on 2026-05-07.

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_status_check;

ALTER TABLE properties
  ADD CONSTRAINT properties_status_check
  CHECK (status = ANY (ARRAY[
    'idea'::text,
    'prospecting'::text,
    'pitched'::text,
    'listed'::text,
    'under_contract'::text,
    'leased'::text,
    'sold'::text,
    'closed'::text,
    'dead'::text,
    'pre_listing'::text,
    'for_lease'::text,
    'off_market'::text
  ]));
