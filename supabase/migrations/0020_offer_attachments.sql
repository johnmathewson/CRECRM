-- 0020_offer_attachments.sql
--
-- File storage for seller-net offers. Each row points at one object in
-- Supabase Storage (private bucket). Most common use: the buyer's actual
-- LOI / offer PDF. We also support 'addendum', 'financing', and 'other'
-- for everything else. The branded seller-net summary PDF is generated on
-- demand from a print route — not stored here.
--
-- Applied via Supabase MCP on 2026-05-07.

INSERT INTO storage.buckets (id, name, public)
VALUES ('offer-attachments', 'offer-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS offer_attachments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  offer_id              uuid NOT NULL REFERENCES seller_net_offers(id) ON DELETE CASCADE,
  property_id           uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  uploaded_via_token_id uuid REFERENCES owner_access_tokens(id) ON DELETE SET NULL,

  file_name             text NOT NULL,
  storage_path          text NOT NULL,
  file_size             bigint,
  mime_type             text,
  doc_type              text NOT NULL DEFAULT 'loi'
    CHECK (doc_type IN ('loi', 'addendum', 'financing', 'other')),
  uploaded_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_offer_attachments_offer
  ON offer_attachments (offer_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_attachments_property
  ON offer_attachments (property_id, uploaded_at DESC);

ALTER TABLE offer_attachments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE org_id constant uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS offer_attachments_anon_all ON offer_attachments';
  EXECUTE 'CREATE POLICY offer_attachments_anon_all ON offer_attachments FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
END $$;

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS offer_attachments_storage_all ON storage.objects';
  EXECUTE $POL$CREATE POLICY offer_attachments_storage_all ON storage.objects FOR ALL TO anon USING (bucket_id = 'offer-attachments') WITH CHECK (bucket_id = 'offer-attachments')$POL$;
END $$;

COMMENT ON TABLE offer_attachments IS
  'Files attached to seller-net offers — buyer LOIs, addenda, financing pre-quals. Storage objects live in the offer-attachments bucket.';
