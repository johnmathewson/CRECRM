-- Migration 0009: Vault flow (Slice D).
--
-- Adds the schema and storage backing the prospect-facing vault: a public
-- questionnaire on the marketing site → click-through NDA → property-specific
-- doc list gated by lead_type + signed consent. Every interaction logs to
-- vault_access_logs so the contact card surfaces real engagement signal.
--
-- Already applied to production via Supabase MCP. Storage buckets
-- (vault-documents, nda-pdfs) and seed NDA v1 records (tenant + buyer)
-- are created out-of-band; their definitions are documented in code
-- (src/lib/nda-text.ts) and persisted in the storage.buckets +
-- public.nda_versions tables respectively.

-- ── documents: extend the existing core-schema table for vault use ─────────
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order  int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_doc_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_doc_category_check
  CHECK (doc_category IS NULL OR doc_category IN ('public','tenant','buyer'));

CREATE INDEX IF NOT EXISTS idx_documents_property
  ON documents (property_id, doc_category)
  WHERE deleted_at IS NULL;

-- ── nda_versions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nda_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_type       text NOT NULL CHECK (lead_type IN ('tenant','buyer')),
  version         int NOT NULL,
  title           text NOT NULL,
  body_md         text NOT NULL,
  effective_at    timestamptz NOT NULL DEFAULT now(),
  deprecated_at   timestamptz,
  UNIQUE (organization_id, lead_type, version)
);
CREATE INDEX IF NOT EXISTS idx_nda_versions_active
  ON nda_versions (organization_id, lead_type)
  WHERE deprecated_at IS NULL;

-- ── questionnaire_submissions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS questionnaire_submissions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  contact_id           uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id              uuid REFERENCES leads(id) ON DELETE SET NULL,
  property_id          uuid REFERENCES properties(id) ON DELETE SET NULL,
  full_name            text NOT NULL,
  email                text NOT NULL,
  phone                text,
  company              text,
  title                text,
  lead_type            text CHECK (lead_type IN ('buyer','seller','tenant','operator','investor')),
  asset_class_pref     text,
  budget_range         text,
  timeline             text,
  geographic_focus     text,
  raw_payload          jsonb,
  ip_address           text,
  user_agent           text,
  submitted_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questionnaire_property ON questionnaire_submissions (property_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_questionnaire_email ON questionnaire_submissions (lower(email));

-- ── nda_signatures ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nda_signatures (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL,
  contact_id               uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id                  uuid REFERENCES leads(id) ON DELETE SET NULL,
  property_id              uuid REFERENCES properties(id) ON DELETE SET NULL,
  questionnaire_id         uuid REFERENCES questionnaire_submissions(id) ON DELETE SET NULL,
  nda_version_id           uuid NOT NULL REFERENCES nda_versions(id),
  typed_name               text NOT NULL,
  typed_email              text NOT NULL,
  ip_address               text,
  user_agent               text,
  text_hash                text NOT NULL,
  signed_pdf_path          text,
  consent_token            text NOT NULL UNIQUE,
  consent_token_expires_at timestamptz NOT NULL,
  signed_at                timestamptz NOT NULL DEFAULT now(),
  revoked_at               timestamptz
);
CREATE INDEX IF NOT EXISTS idx_nda_sigs_token ON nda_signatures (consent_token) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_nda_sigs_property ON nda_signatures (property_id, signed_at DESC);

-- ── vault_access_logs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vault_access_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  property_id     uuid REFERENCES properties(id) ON DELETE SET NULL,
  document_id     uuid REFERENCES documents(id) ON DELETE SET NULL,
  nda_signature_id uuid REFERENCES nda_signatures(id) ON DELETE SET NULL,
  access_type     text NOT NULL CHECK (access_type IN ('list_view','download','flyer_download','vault_landing')),
  ip_address      text,
  user_agent      text,
  accessed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vault_logs_property ON vault_access_logs (property_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_logs_signature ON vault_access_logs (nda_signature_id, accessed_at DESC);

-- ── RLS — anon scoped to org ────────────────────────────────────────────────
ALTER TABLE nda_versions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_submissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nda_signatures             ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault_access_logs          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE org_id constant uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS documents_anon_all ON documents';
  EXECUTE 'CREATE POLICY documents_anon_all ON documents FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';

  EXECUTE 'DROP POLICY IF EXISTS nda_versions_anon_all ON nda_versions';
  EXECUTE 'CREATE POLICY nda_versions_anon_all ON nda_versions FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';

  EXECUTE 'DROP POLICY IF EXISTS questionnaire_anon_all ON questionnaire_submissions';
  EXECUTE 'CREATE POLICY questionnaire_anon_all ON questionnaire_submissions FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';

  EXECUTE 'DROP POLICY IF EXISTS nda_signatures_anon_all ON nda_signatures';
  EXECUTE 'CREATE POLICY nda_signatures_anon_all ON nda_signatures FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';

  EXECUTE 'DROP POLICY IF EXISTS vault_logs_anon_all ON vault_access_logs';
  EXECUTE 'CREATE POLICY vault_logs_anon_all ON vault_access_logs FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
END $$;

COMMENT ON COLUMN documents.doc_category IS 'public | tenant | buyer — gates vault visibility';
COMMENT ON TABLE nda_versions IS 'Versioned NDA text. Old signatures stay legally tied to the exact text shown.';
COMMENT ON TABLE nda_signatures IS 'Audit-grade signature record: typed name, IP, UA, exact-text hash, generated PDF, consent_token for vault access.';
COMMENT ON TABLE vault_access_logs IS 'Every vault interaction. Powers engagement signals on contact cards.';
