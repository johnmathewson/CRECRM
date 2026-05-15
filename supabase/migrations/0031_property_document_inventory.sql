-- 0031_property_document_inventory.sql
--
-- Per-property document inventory with sensitivity tiers.
--
-- When a prospective buyer asks "can you send me the rent roll" or "do you
-- have environmental reports", the Prospector personalizer needs to know:
--   (a) what documents we actually have for this listing
--   (b) what tier of disclosure each one requires (public / qualified / NDA / restricted)
--
-- Without this, the AI either makes up document names or treats every
-- request the same. With it, it can say "I have the rent roll — it's a
-- tier-2 document, here's what I need from you to release it" or "we
-- don't have environmental reports on file yet."
--
-- Structure (jsonb array of {name, tier}):
--   [
--     { "name": "Public flyer",       "tier": "public" },
--     { "name": "Full OM",            "tier": "qualified" },
--     { "name": "Rent roll",          "tier": "nda" },
--     { "name": "Tenant lease docs",  "tier": "nda" },
--     { "name": "Bottom-line price",  "tier": "restricted" }
--   ]

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS document_inventory jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN properties.document_inventory IS
  'Per-property inventory of marketing/due-diligence documents and their sensitivity tier (public / qualified / nda / restricted). Read by the Prospector personalizer when buyers ask for specific documents.';
