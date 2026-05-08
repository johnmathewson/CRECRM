-- 0023_constraint_widenings_phase8_alignment.sql
--
-- Three more constraint mismatches found by the diagnostic sweep — every
-- one a UI surface that exposes a value the DB rejects. All silent-fail
-- categories.
--
-- Applied via Supabase MCP on 2026-05-08.

-- ── deals.deal_type ────────────────────────────────────────────────────
-- UI exposes Sale / Lease / Buyer rep (CreateDealDialog). DB only allowed
-- sale | lease, so picking Buyer rep 500'd. The whole Pursuits side of
-- the pipeline depends on deal_type='buyer_rep' — pipeline-queries.ts
-- filters with `d.deal_type === 'buyer_rep'` to bucket pursuits, which
-- has been impossible to populate via the UI since Phase 8 shipped.
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_deal_type_check;
ALTER TABLE deals ADD CONSTRAINT deals_deal_type_check
  CHECK (deal_type = ANY (ARRAY['sale'::text, 'lease'::text, 'buyer_rep'::text]));

-- ── contacts.contact_type ──────────────────────────────────────────────
-- UI exposes 9 types in CreateContactDialog (owner via "Seller / Owner",
-- buyer via "Buyer / Investor", tenant, broker, lender, attorney, vendor,
-- referral, other). DB allowed only 8 — missing 'seller', 'vendor',
-- 'referral'. Picking any of those silently failed.
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type = ANY (ARRAY[
    'owner'::text, 'buyer'::text, 'seller'::text, 'tenant'::text,
    'investor'::text, 'lender'::text, 'attorney'::text, 'broker'::text,
    'vendor'::text, 'referral'::text, 'other'::text
  ]));

-- ── contacts.warmth ────────────────────────────────────────────────────
-- UI exposes Hot / Warm / Cool / Cold. DB allowed hot | warm | cold |
-- dormant. Picking "Cool" failed; nothing in the UI could pick "dormant"
-- (legacy value, kept for any auto-classifier that might use it).
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_warmth_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_warmth_check
  CHECK (warmth = ANY (ARRAY['hot'::text, 'warm'::text, 'cool'::text, 'cold'::text, 'dormant'::text]));
