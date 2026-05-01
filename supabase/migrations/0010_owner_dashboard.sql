-- Migration 0010: Owner dashboard infrastructure.
--
-- Adds metrics persistence, magic-link auth for owners, on-demand sync
-- queue for the Chrome extension, and own-site page-view tracking.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS loopnet_url        text,
  ADD COLUMN IF NOT EXISTS loopnet_listing_id text;

CREATE TABLE IF NOT EXISTS listing_metrics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('crexi','loopnet','site')),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  views           int  DEFAULT 0,
  saves           int  DEFAULT 0,
  inquiries       int  DEFAULT 0,
  downloads       int  DEFAULT 0,
  raw_payload     jsonb,
  scraped_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, source, period_start)
);
CREATE INDEX IF NOT EXISTS idx_metrics_property_period ON listing_metrics (property_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_org_period ON listing_metrics (organization_id, period_start DESC);

CREATE TABLE IF NOT EXISTS owner_access_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  token             text NOT NULL UNIQUE,
  owner_contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  property_ids      uuid[] NOT NULL,
  label             text,
  expires_at        timestamptz NOT NULL,
  last_viewed_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_owner_tokens_lookup ON owner_access_tokens (token) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_owner_tokens_org ON owner_access_tokens (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS metric_sync_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id     uuid REFERENCES properties(id) ON DELETE CASCADE,
  source          text CHECK (source IN ('crexi','loopnet','site','any')),
  reason          text,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  fulfilled_at    timestamptz,
  failed_at       timestamptz,
  failure_reason  text
);
CREATE INDEX IF NOT EXISTS idx_sync_requests_pending ON metric_sync_requests (requested_at DESC) WHERE fulfilled_at IS NULL AND failed_at IS NULL;

CREATE TABLE IF NOT EXISTS page_views (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id     uuid REFERENCES properties(id) ON DELETE SET NULL,
  slug            text,
  path            text,
  referer         text,
  ip_hash         text,
  ua_summary      text,
  viewed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_views_property_time ON page_views (property_id, viewed_at DESC) WHERE property_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS extension_api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  key_hash        text NOT NULL UNIQUE,
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_extension_keys_active ON extension_api_keys (key_hash) WHERE revoked_at IS NULL;

ALTER TABLE listing_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_access_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_sync_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_views            ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_api_keys    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE org_id constant uuid := 'a0000000-0000-0000-0000-000000000001';
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS listing_metrics_anon_all ON listing_metrics';
  EXECUTE 'CREATE POLICY listing_metrics_anon_all ON listing_metrics FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
  EXECUTE 'DROP POLICY IF EXISTS owner_tokens_anon_all ON owner_access_tokens';
  EXECUTE 'CREATE POLICY owner_tokens_anon_all ON owner_access_tokens FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
  EXECUTE 'DROP POLICY IF EXISTS sync_requests_anon_all ON metric_sync_requests';
  EXECUTE 'CREATE POLICY sync_requests_anon_all ON metric_sync_requests FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
  EXECUTE 'DROP POLICY IF EXISTS page_views_anon_all ON page_views';
  EXECUTE 'CREATE POLICY page_views_anon_all ON page_views FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
  EXECUTE 'DROP POLICY IF EXISTS extension_keys_anon_all ON extension_api_keys';
  EXECUTE 'CREATE POLICY extension_keys_anon_all ON extension_api_keys FOR ALL TO anon USING (organization_id = ''' || org_id || ''') WITH CHECK (organization_id = ''' || org_id || ''')';
END $$;

COMMENT ON TABLE listing_metrics IS 'Weekly per-source per-property metric snapshots. Powers the owner dashboard.';
COMMENT ON TABLE owner_access_tokens IS 'Magic-link tokens. property_ids array scopes which listings the owner can view.';
COMMENT ON TABLE metric_sync_requests IS 'Queue of "refresh this listings metrics" requests for the Chrome extension to fulfill.';
COMMENT ON TABLE page_views IS 'Own-site listing detail-page views. ip_hash + ua_summary = anonymous, GDPR-safer.';
COMMENT ON TABLE extension_api_keys IS 'Long-lived API keys the Chrome extension uses to authenticate to /api/extension/*.';
