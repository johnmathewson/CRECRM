-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0003: Fold deals into properties (unified pipeline architecture)
--
-- Strategic reframe: properties = source of truth. Each property progresses
-- through ONE pipeline (Lead → LOI → Listing → Under Contract → Closed) which
-- previously lived on `deals` via deal_stages. The /deals page in the UI
-- becomes a kanban view of properties grouped by pipeline_stage; financial
-- fields (price, commission, probability) live on the property record itself.
--
-- The deals table stays in place for historical reference until the UI
-- refactor finishes; future writes happen on properties only.
--
-- Applied to production via Supabase MCP `apply_migration` on 2026-05-04.
-- Verified: 16 properties total across 4 stages (2 Lead, 3 Listing, 1 Under
-- Contract, 10 Closed). 15 deals all linked to properties (0 orphans).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Unified stage enum (matches deal_stages values, plus 'Dead' for lost deals)
DO $$ BEGIN
  CREATE TYPE pipeline_stage AS ENUM ('Lead', 'LOI', 'Listing', 'Under Contract', 'Closed', 'Dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Add stage + deal financial columns to properties
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS pipeline_stage pipeline_stage NOT NULL DEFAULT 'Lead',
  ADD COLUMN IF NOT EXISTS agreed_price numeric,
  ADD COLUMN IF NOT EXISTS commission_pct numeric,
  ADD COLUMN IF NOT EXISTS estimated_commission numeric,
  ADD COLUMN IF NOT EXISTS probability_pct numeric,
  ADD COLUMN IF NOT EXISTS weighted_commission numeric,
  ADD COLUMN IF NOT EXISTS expected_close date,
  ADD COLUMN IF NOT EXISTS actual_close date,
  ADD COLUMN IF NOT EXISTS is_dead boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dead_reason text,
  ADD COLUMN IF NOT EXISTS client_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to uuid;

-- 3. Detach the recently mis-attached "Liberty Square Retail" deal from
--    3005 John Howell Drive — it'll become its own property record below.
UPDATE deals SET property_id = NULL
WHERE id = '36e5d372-ed37-4fe1-978c-22f85ced693a';

-- 4. For properties that have a linked deal: fold deal data onto the property
--    record and derive pipeline_stage from deal_stages (the row where
--    exited_at IS NULL is the deal's current stage).
WITH deal_w_stage AS (
  SELECT
    d.*,
    (SELECT stage FROM deal_stages ds WHERE ds.deal_id = d.id AND ds.exited_at IS NULL LIMIT 1) AS current_stage
  FROM deals d
  WHERE d.property_id IS NOT NULL
)
UPDATE properties p
SET
  transaction_type = COALESCE(p.transaction_type, d.deal_type),
  agreed_price = d.price,
  commission_pct = d.commission_pct,
  estimated_commission = d.estimated_commission,
  probability_pct = d.probability_pct,
  weighted_commission = d.weighted_commission,
  expected_close = d.expected_close,
  actual_close = d.actual_close,
  is_dead = COALESCE(d.is_dead, false),
  dead_reason = d.dead_reason,
  client_contact_id = d.client_contact_id,
  assigned_to = d.assigned_to,
  pipeline_stage = (CASE
    WHEN d.is_dead THEN 'Dead'
    WHEN d.is_closed THEN 'Closed'
    WHEN d.current_stage IN ('Lead','LOI','Listing','Under Contract','Closed') THEN d.current_stage
    WHEN p.status IN ('sold','leased') THEN 'Closed'
    WHEN p.status = 'under_contract' THEN 'Under Contract'
    WHEN p.status IN ('listed','for_lease') THEN 'Listing'
    WHEN p.status = 'pre_listing' THEN 'LOI'
    WHEN p.status = 'off_market' THEN 'Dead'
    ELSE 'Lead'
  END)::pipeline_stage
FROM deal_w_stage d
WHERE p.id = d.property_id;

-- 5. Properties without any linked deal: derive pipeline_stage from old status.
UPDATE properties p
SET pipeline_stage = (CASE
  WHEN p.status IN ('sold','leased') THEN 'Closed'
  WHEN p.status = 'under_contract' THEN 'Under Contract'
  WHEN p.status IN ('listed','for_lease') THEN 'Listing'
  WHEN p.status = 'pre_listing' THEN 'LOI'
  WHEN p.status = 'off_market' THEN 'Dead'
  WHEN p.status = 'idea' THEN 'Lead'
  ELSE 'Lead'
END)::pipeline_stage
WHERE p.organization_id = 'a0000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.property_id = p.id);

-- 6. Promote each orphan deal to a property record. Asset type best-guessed
--    from deal name keywords; broker can refine afterward.
WITH deal_w_stage AS (
  SELECT
    d.*,
    (SELECT stage FROM deal_stages ds WHERE ds.deal_id = d.id AND ds.exited_at IS NULL LIMIT 1) AS current_stage
  FROM deals d
  WHERE d.property_id IS NULL
    AND d.organization_id = 'a0000000-0000-0000-0000-000000000001'
)
INSERT INTO properties (
  organization_id, name,
  asset_type, status, pipeline_stage,
  transaction_type,
  agreed_price, commission_pct, estimated_commission,
  probability_pct, weighted_commission,
  expected_close, actual_close,
  is_dead, dead_reason,
  client_contact_id, assigned_to,
  your_role
)
SELECT
  d.organization_id,
  d.deal_name,
  CASE
    WHEN d.deal_name ILIKE '%land%' THEN 'land'
    WHEN d.deal_name ILIKE '%inn%' OR d.deal_name ILIKE '%motel%' OR d.deal_name ILIKE '%hotel%' THEN 'hospitality'
    WHEN d.deal_name ILIKE '%retail%' OR d.deal_name ILIKE '%liberty square%' OR d.deal_name ILIKE '%plaza%' THEN 'retail'
    WHEN d.deal_name ILIKE '%office%' OR d.deal_name ILIKE '%medical%' THEN 'office'
    WHEN d.deal_name ILIKE '%industrial%' OR d.deal_name ILIKE '%warehouse%' OR d.deal_name ILIKE '%flex%' THEN 'industrial'
    ELSE NULL
  END,
  -- Old status field for legacy UI compatibility during the transition
  (CASE
    WHEN d.is_dead THEN 'off_market'
    WHEN d.is_closed AND d.deal_type = 'lease' THEN 'leased'
    WHEN d.is_closed THEN 'sold'
    WHEN d.current_stage = 'Listing' AND d.deal_type = 'lease' THEN 'for_lease'
    WHEN d.current_stage = 'Listing' THEN 'listed'
    WHEN d.current_stage = 'Under Contract' THEN 'under_contract'
    WHEN d.current_stage = 'LOI' THEN 'pre_listing'
    ELSE 'idea'
  END),
  (CASE
    WHEN d.is_dead THEN 'Dead'
    WHEN d.is_closed THEN 'Closed'
    WHEN d.current_stage IN ('Lead','LOI','Listing','Under Contract','Closed') THEN d.current_stage
    ELSE 'Lead'
  END)::pipeline_stage,
  d.deal_type,
  d.price,
  d.commission_pct,
  d.estimated_commission,
  d.probability_pct,
  d.weighted_commission,
  d.expected_close,
  d.actual_close,
  COALESCE(d.is_dead, false),
  d.dead_reason,
  d.client_contact_id,
  d.assigned_to,
  'listing_broker'
FROM deal_w_stage d;

-- 7. Re-link each (formerly orphan) deal to its newly-created property record.
UPDATE deals d
SET property_id = p.id
FROM properties p
WHERE p.organization_id = d.organization_id
  AND p.name = d.deal_name
  AND d.property_id IS NULL;

-- Indexes for fast kanban grouping + closed-commission lookups
CREATE INDEX IF NOT EXISTS idx_properties_pipeline_stage
  ON properties (pipeline_stage)
  WHERE NOT is_dead;
CREATE INDEX IF NOT EXISTS idx_properties_actual_close
  ON properties (actual_close DESC)
  WHERE pipeline_stage = 'Closed';
