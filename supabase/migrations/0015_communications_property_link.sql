-- 0015_communications_property_link.sql
--
-- Phase 4 schema move: give communications a direct link to properties.
-- Previously emails resolved to a property only indirectly (via lead.property_id
-- or deal.property_id). The Property workspace's Communications panel needs a
-- direct query — this column lets it run efficiently and supports outbound
-- emails composed FROM a property workspace (no lead/deal link).
--
-- Applied via Supabase MCP on 2026-05-07; backfill ran the same day, populated
-- 2 of 17 existing rows. Future rows are tagged at write time by the inbox
-- watcher and the (forthcoming) compose-from-property flow.

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS property_id uuid
  REFERENCES properties(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS communications_property_id_occurred_at_idx
  ON communications (property_id, occurred_at DESC)
  WHERE property_id IS NOT NULL;

-- Backfill: derive from the most direct link available.
UPDATE communications c
SET property_id = l.property_id
FROM leads l
WHERE c.property_id IS NULL
  AND c.lead_id = l.id
  AND l.property_id IS NOT NULL;

UPDATE communications c
SET property_id = d.property_id
FROM deals d
WHERE c.property_id IS NULL
  AND c.deal_id = d.id
  AND d.property_id IS NOT NULL;
