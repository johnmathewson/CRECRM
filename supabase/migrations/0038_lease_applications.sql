-- 0038 — Commercial lease applications submitted from stewardshipcre.com.
--
-- Applicant financials and guarantor identities are the most sensitive
-- records in the CRM, so unlike most tables here these get NO anon policy:
-- the public site writes only through /api/public/lease-applications, which
-- uses the service role, and the CRM reads them as a logged-in
-- (authenticated) session. Files go to a private bucket the same way.
--
-- SSN and date of birth are deliberately not collected online; the credit
-- check vendor collects them directly from the guarantor.
--
-- Applied via Supabase MCP on 2026-10-15, split into 0038a–0038e (the MCP
-- times out on multi-statement policy DDL); end state is this file.

CREATE TABLE IF NOT EXISTS lease_applications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  submitted_at            timestamptz,
  status                  text NOT NULL DEFAULT 'pending_upload'
                            CHECK (status IN ('pending_upload','submitted','reviewing','approved','declined','withdrawn')),
  -- Hash of the one-time token the browser uses to finalize its own upload.
  finalize_token_hash     text NOT NULL,
  -- Files the browser said it would upload: [{doc_type, file_name, size, mime_type, path}]
  pending_files           jsonb NOT NULL DEFAULT '[]'::jsonb,

  property_id             uuid REFERENCES properties(id) ON DELETE SET NULL,
  property_label          text,
  suite                   text,
  lead_id                 uuid REFERENCES leads(id) ON DELETE SET NULL,
  contact_id              uuid REFERENCES contacts(id) ON DELETE SET NULL,

  business_legal_name     text NOT NULL,
  dba                     text,
  intended_use            text,
  fein                    text,
  years_in_business       numeric,
  entity_type             text CHECK (entity_type IS NULL OR entity_type IN ('llc','corporation','partnership','sole_proprietor','other')),
  entity_type_other       text,
  state_of_formation      text,
  business_address        text,
  business_phone          text,
  business_email          text,

  -- [{name, title, ownership_pct, guarantor, phone, email, home_address}]
  owners                  jsonb NOT NULL DEFAULT '[]'::jsonb,

  current_address         text,
  current_monthly_rent    numeric,
  current_tenure          text CHECK (current_tenure IS NULL OR current_tenure IN ('rent','own','none')),
  current_landlord        text,
  current_landlord_phone  text,

  -- [{name, phone, email}]
  trade_references        jsonb NOT NULL DEFAULT '[]'::jsonb,

  monthly_revenue         numeric,
  monthly_expenses        numeric,
  cash_savings            numeric,
  total_assets            numeric,
  total_liabilities       numeric,
  startup_cost            numeric,
  funding_source          text,

  desired_sf              text,
  desired_move_in         text,
  notes                   text,

  credit_authorization    boolean NOT NULL CHECK (credit_authorization),
  -- [{name, signed_at}] — typed electronic signatures
  signatures              jsonb NOT NULL DEFAULT '[]'::jsonb,
  sms_consent             boolean NOT NULL DEFAULT false,
  sms_consent_text        text,
  submitter_ip            text,
  user_agent              text
);

CREATE INDEX IF NOT EXISTS lease_applications_org_created_idx ON lease_applications (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lease_applications_lead_idx ON lease_applications (lead_id);

CREATE TABLE IF NOT EXISTS lease_application_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  application_id   uuid NOT NULL REFERENCES lease_applications(id) ON DELETE CASCADE,
  doc_type         text NOT NULL CHECK (doc_type IN (
                     'photo_id','business_tax_return','personal_tax_return','bank_statement',
                     'profit_loss','balance_sheet','personal_financial_statement','business_plan','other')),
  file_name        text NOT NULL,
  storage_path     text NOT NULL UNIQUE,
  file_size        bigint,
  mime_type        text,
  uploaded_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lease_application_documents_app_idx ON lease_application_documents (application_id);

ALTER TABLE lease_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_application_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lease_applications_authenticated_all ON lease_applications;
CREATE POLICY lease_applications_authenticated_all ON lease_applications
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS lease_application_documents_authenticated_all ON lease_application_documents;
CREATE POLICY lease_application_documents_authenticated_all ON lease_application_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE lease_applications IS 'Commercial lease applications from the public site. No anon policy: written by the service role, read by authenticated CRM sessions.';
COMMENT ON TABLE lease_application_documents IS 'Files attached to a lease application (photo IDs, tax returns, bank statements, financials). Objects live in the private lease-applications bucket.';

-- Private bucket. 25 MB per file; PDFs, images, spreadsheets, Word docs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lease-applications', 'lease-applications', false, 26214400,
  ARRAY[
    'application/pdf','image/jpeg','image/png','image/heic','image/heif','image/webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- CRM sessions can read (sign download URLs) and delete; uploads only happen
-- through service-role signed upload URLs, so there is no insert policy.
DROP POLICY IF EXISTS "lease_applications authenticated read" ON storage.objects;
CREATE POLICY "lease_applications authenticated read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'lease-applications');

DROP POLICY IF EXISTS "lease_applications authenticated delete" ON storage.objects;
CREATE POLICY "lease_applications authenticated delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'lease-applications');
