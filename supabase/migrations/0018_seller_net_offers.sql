-- 0018_seller_net_offers.sql
--
-- Stores "what would I net?" offer analyses run from the owner portal.
-- Each row = one named scenario (e.g. "Smith Group — 4/22"). Inputs are
-- preserved as structured data so the broker can come back, tweak, and
-- compare side-by-side. Computed totals are also denormalized so the
-- comparison view doesn't have to re-derive them.
--
-- Applied via Supabase MCP on 2026-05-07.

CREATE TABLE IF NOT EXISTS seller_net_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  property_id           uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_via_token_id  uuid REFERENCES owner_access_tokens(id) ON DELETE SET NULL,

  title                 text NOT NULL,
  buyer_name            text,
  offer_date            date,

  offer_price           numeric NOT NULL,
  commission_pct        numeric,
  commission_amount     numeric,
  -- Array of { label, amount, sign: 'credit'|'debit' }
  line_items            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Array of { name, capital, pref_pct, hold_years, ownership_pct }
  partners              jsonb NOT NULL DEFAULT '[]'::jsonb,

  computed_commission   numeric,
  computed_adjustments  numeric,
  computed_net_proceeds numeric,
  computed_partners_due numeric,
  computed_net_after_partners numeric,

  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_net_offers_property
  ON seller_net_offers (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_net_offers_org
  ON seller_net_offers (organization_id, created_at DESC);

ALTER TABLE seller_net_offers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE org_id constant uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS seller_net_offers_anon_all ON seller_net_offers';
  EXECUTE 'CREATE POLICY seller_net_offers_anon_all ON seller_net_offers FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
END $$;

COMMENT ON TABLE seller_net_offers IS
  'Owner-portal offer analyses — what the seller would net under a given scenario. Stored per property, accessible via owner_access_tokens.';
