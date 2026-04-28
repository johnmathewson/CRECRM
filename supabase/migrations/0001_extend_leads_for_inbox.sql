-- Migration 0001: Extend leads for the inbound-lead inbox pipeline.
--
-- Strategy: rather than create a new "inbox" table, we extend the existing
-- `leads` table (already used by the public valuation_agent endpoint as the
-- universal capture point) and thread inbound/outbound messages via the
-- existing `communications` table (already has channel/direction/from/to/
-- subject/body/raw_payload — exactly what we'd need for thread).
--
-- This is backwards-compatible: existing rows (e.g. valuation_agent leads)
-- get NULLs for the new fields and continue working untouched.
--
-- Applied to production via Supabase MCP `apply_migration` on 2026-04-27
-- before this file was committed to the repo.

-- Enums for richer typing of inbox concepts
DO $$ BEGIN
  CREATE TYPE lead_intent AS ENUM ('buy','lease','sell','info','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_urgency AS ENUM ('hot','warm','cold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend leads with inbox-specific fields. Existing columns preserved.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sender_name        text,
  ADD COLUMN IF NOT EXISTS sender_email       text,
  ADD COLUMN IF NOT EXISTS sender_phone       text,
  ADD COLUMN IF NOT EXISTS property_label     text,
  ADD COLUMN IF NOT EXISTS intent             lead_intent,
  ADD COLUMN IF NOT EXISTS urgency            lead_urgency DEFAULT 'warm',
  ADD COLUMN IF NOT EXISTS qualifier_summary  text,
  ADD COLUMN IF NOT EXISTS raw_subject        text,
  ADD COLUMN IF NOT EXISTS raw_body           text,
  ADD COLUMN IF NOT EXISTS claude_extraction  jsonb,
  ADD COLUMN IF NOT EXISTS auto_ack_sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS draft_reply        text,
  ADD COLUMN IF NOT EXISTS draft_attachments  jsonb,
  ADD COLUMN IF NOT EXISTS final_reply        text,
  ADD COLUMN IF NOT EXISTS final_sent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS linked_deal_id     uuid REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_status_created ON leads (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_urgency        ON leads (urgency) WHERE urgency IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_property       ON leads (property_id);
CREATE INDEX IF NOT EXISTS idx_leads_contact        ON leads (contact_id);

-- Thread: link communications rows to a lead so the inbox can show conversation
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_communications_lead ON communications (lead_id, occurred_at DESC);
