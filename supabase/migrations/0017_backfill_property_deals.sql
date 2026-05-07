-- 0017_backfill_property_deals.sql
--
-- Phase 8 fix: every property with an active lifecycle status should have a
-- corresponding active deal row, otherwise the property is invisible in the
-- pipeline view. The "John Howell" gap.
--
-- This migration is idempotent — it creates a paired deal only for
-- properties that don't already have one.
--
-- Applied via Supabase MCP on 2026-05-07.

DO $$
DECLARE
  prop RECORD;
  new_deal_id uuid;
  target_stage text;
  default_user uuid := 'b0000000-0000-0000-0000-000000000001';
  org uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  FOR prop IN
    SELECT p.id, p.name, p.headline, p.status, p.transaction_type,
           p.asking_price, p.lease_rate
    FROM properties p
    WHERE p.organization_id = org
      AND p.status IN ('listed', 'under_contract', 'pitched', 'prospecting')
      AND NOT EXISTS (
        SELECT 1 FROM deals d
        WHERE d.property_id = p.id
          AND d.organization_id = org
          AND d.is_closed = false
          AND d.is_dead = false
      )
  LOOP
    target_stage := CASE prop.status
      WHEN 'listed'         THEN 'Active Listing'
      WHEN 'under_contract' THEN 'Due Diligence'
      WHEN 'pitched'        THEN 'BOV'
      WHEN 'prospecting'    THEN 'Prospecting'
      ELSE 'Lead'
    END;

    INSERT INTO deals (
      organization_id, property_id, deal_type, deal_name,
      price, probability_pct, assigned_to
    ) VALUES (
      org,
      prop.id,
      COALESCE(prop.transaction_type, 'sale'),
      COALESCE(prop.headline, prop.name) || ' — ' ||
        CASE WHEN prop.transaction_type = 'lease' THEN 'Lease' ELSE 'Sale' END,
      CASE WHEN prop.transaction_type = 'lease' THEN prop.lease_rate ELSE prop.asking_price END,
      75,
      default_user
    )
    RETURNING id INTO new_deal_id;

    INSERT INTO deal_stages (deal_id, stage, entered_at, entered_by, notes)
    VALUES (
      new_deal_id,
      target_stage,
      now(),
      default_user,
      'Backfilled by 0017 — property was at status="' || prop.status || '" without an active deal'
    );
  END LOOP;
END $$;
