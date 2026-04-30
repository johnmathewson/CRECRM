-- Migration 0006: RLS policies that let the lead-intake pipeline write.
--
-- Existing tables only allow `authenticated` role inserts gated by
-- `get_my_org_id()`. The API routes use the `anon` key (no session
-- cookies on server-side fetch), so every write was being silently
-- rejected. Result: nothing was actually persisting.
--
-- Approach: add anon INSERT/SELECT/UPDATE policies scoped to the
-- single broker's org_id. This mirrors the existing
-- `leads_public_insert` policy pattern. Single-tenant for now;
-- tighten when we go multi-user.

DO $$
DECLARE
  org_id constant uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  -- ── leads: extend anon insert beyond just valuation_agent ──────────────
  EXECUTE 'DROP POLICY IF EXISTS leads_public_insert ON leads';
  EXECUTE 'CREATE POLICY leads_anon_all ON leads FOR ALL TO anon
    USING (organization_id = ''' || org_id || ''')
    WITH CHECK (organization_id = ''' || org_id || ''')';

  -- ── communications ──
  EXECUTE 'DROP POLICY IF EXISTS communications_anon_all ON communications';
  EXECUTE 'CREATE POLICY communications_anon_all ON communications FOR ALL TO anon
    USING (organization_id = ''' || org_id || ''')
    WITH CHECK (organization_id = ''' || org_id || ''')';

  -- ── contacts ──
  EXECUTE 'DROP POLICY IF EXISTS contacts_anon_all ON contacts';
  EXECUTE 'CREATE POLICY contacts_anon_all ON contacts FOR ALL TO anon
    USING (organization_id = ''' || org_id || ''')
    WITH CHECK (organization_id = ''' || org_id || ''')';

  -- ── properties ──
  EXECUTE 'DROP POLICY IF EXISTS properties_anon_all ON properties';
  EXECUTE 'CREATE POLICY properties_anon_all ON properties FOR ALL TO anon
    USING (organization_id = ''' || org_id || ''')
    WITH CHECK (organization_id = ''' || org_id || ''')';

  -- ── deals ──
  EXECUTE 'DROP POLICY IF EXISTS deals_anon_all ON deals';
  EXECUTE 'CREATE POLICY deals_anon_all ON deals FOR ALL TO anon
    USING (organization_id = ''' || org_id || ''')
    WITH CHECK (organization_id = ''' || org_id || ''')';

  -- ── deal_stages ── (joined via deal_id, not direct org_id)
  EXECUTE 'DROP POLICY IF EXISTS deal_stages_anon_all ON deal_stages';
  EXECUTE 'CREATE POLICY deal_stages_anon_all ON deal_stages FOR ALL TO anon
    USING (deal_id IN (SELECT id FROM deals WHERE organization_id = ''' || org_id || '''))
    WITH CHECK (deal_id IN (SELECT id FROM deals WHERE organization_id = ''' || org_id || '''))';

  -- ── lead_events ── (RLS was disabled; turn on with anon-friendly policy)
  EXECUTE 'ALTER TABLE lead_events ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS lead_events_anon_all ON lead_events';
  EXECUTE 'CREATE POLICY lead_events_anon_all ON lead_events FOR ALL TO anon
    USING (organization_id = ''' || org_id || ''')
    WITH CHECK (organization_id = ''' || org_id || ''')';
END $$;

COMMENT ON POLICY leads_anon_all          ON leads          IS 'Single-broker CRM: anon-key API routes can read/write rows for the hardcoded org. Tighten when multi-user.';
COMMENT ON POLICY communications_anon_all ON communications IS 'Single-broker CRM: anon-key API routes scoped to hardcoded org.';
COMMENT ON POLICY contacts_anon_all       ON contacts       IS 'Single-broker CRM: anon-key API routes scoped to hardcoded org.';
COMMENT ON POLICY properties_anon_all     ON properties     IS 'Single-broker CRM: anon-key API routes scoped to hardcoded org.';
COMMENT ON POLICY deals_anon_all          ON deals          IS 'Single-broker CRM: anon-key API routes scoped to hardcoded org.';
COMMENT ON POLICY deal_stages_anon_all    ON deal_stages    IS 'Single-broker CRM: scoped via parent deal''s org.';
COMMENT ON POLICY lead_events_anon_all    ON lead_events    IS 'Single-broker CRM: anon-key API routes scoped to hardcoded org.';
