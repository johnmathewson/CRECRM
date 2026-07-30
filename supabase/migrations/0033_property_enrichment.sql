-- Migration 0033: Property Enrichment Agent — facts ledger, run ledger, request queue.
-- Applied to production via Supabase MCP 2026-07-29 before being committed.
--
-- Architecture (agreed 2026-07-29):
--   property_facts      field-level enrichment with PROVENANCE. Agents never
--                       overwrite human data — they fill blanks on properties
--                       and record every finding here with source/confidence.
--   enrichment_runs     one row per agent run — the visible diff John reads.
--   enrichment_requests shared work queue: campaigns + other agents push
--                       "I need X enriched", enrichers pull ahead of their
--                       default grind. Built now, consumed by later agents.

CREATE TABLE IF NOT EXISTS property_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  field text NOT NULL,
  value text,
  value_json jsonb,
  source text NOT NULL,             -- 'derived' | 'sale_comps' | 'contacts' | 'haiku_match' | 'agent'
  source_ref uuid,                  -- row id in the source table when applicable
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','low')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','conflict','superseded')),
  note text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, field, source)
);
CREATE INDEX IF NOT EXISTS idx_property_facts_property ON property_facts (property_id);
CREATE INDEX IF NOT EXISTS idx_property_facts_field ON property_facts (field);

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  agent text NOT NULL,              -- 'property_enricher' (later: 'contact_enricher', ...)
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scanned integer NOT NULL DEFAULT 0,
  facts_written integer NOT NULL DEFAULT 0,
  fields_filled integer NOT NULL DEFAULT 0,   -- blanks filled directly on properties
  conflicts integer NOT NULL DEFAULT 0,
  summary text,
  details jsonb
);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_agent ON enrichment_runs (agent, started_at DESC);

CREATE TABLE IF NOT EXISTS enrichment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('property','contact')),
  entity_id uuid NOT NULL,
  fields text[],                    -- specific fields wanted; null = everything
  priority integer NOT NULL DEFAULT 100,   -- lower = sooner
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped')),
  requested_by text,                -- 'campaign:<id>' | 'communication_agent' | 'manual'
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_enrichment_requests_open ON enrichment_requests (entity_type, status, priority);

-- Single-user permissive RLS, matching the 0006 pattern.
ALTER TABLE property_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrichment_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY property_facts_all ON property_facts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY enrichment_runs_all ON enrichment_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY enrichment_requests_all ON enrichment_requests FOR ALL USING (true) WITH CHECK (true);
