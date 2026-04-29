-- Migration 0003: Extend properties table for the new Add Listing Wizard.
-- Adds fields to match CREXi's listing field set and support the wizard's
-- syndication tracking, AI extraction metadata, and richer property data.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS transaction_type     text,
  ADD COLUMN IF NOT EXISTS acreage              numeric(10,4),
  ADD COLUMN IF NOT EXISTS parking_spaces       integer,
  ADD COLUMN IF NOT EXISTS parking_ratio        text,
  ADD COLUMN IF NOT EXISTS zoning               text,
  ADD COLUMN IF NOT EXISTS noi                  numeric(14,2),
  ADD COLUMN IF NOT EXISTS cap_rate             numeric(6,3),
  ADD COLUMN IF NOT EXISTS price_per_sf         numeric(10,2),
  ADD COLUMN IF NOT EXISTS occupancy_pct        numeric(5,2),
  ADD COLUMN IF NOT EXISTS description          text,
  ADD COLUMN IF NOT EXISTS highlights           jsonb,
  ADD COLUMN IF NOT EXISTS crexi_url            text,
  ADD COLUMN IF NOT EXISTS publish_to_website   boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS crexi_sync_status    text DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS crexi_listing_id     text,
  ADD COLUMN IF NOT EXISTS crexi_synced_at      timestamptz,
  ADD COLUMN IF NOT EXISTS source_import        text;

-- Index for website-published listings (used by public site query)
CREATE INDEX IF NOT EXISTS idx_properties_publish_website
  ON properties (publish_to_website, status)
  WHERE publish_to_website = true;

-- Index for CREXi sync queue
CREATE INDEX IF NOT EXISTS idx_properties_crexi_sync
  ON properties (crexi_sync_status)
  WHERE crexi_sync_status = 'pending';

COMMENT ON COLUMN properties.transaction_type IS 'sale | lease | sale_or_lease';
COMMENT ON COLUMN properties.crexi_sync_status IS 'not_synced | pending | synced | error';
COMMENT ON COLUMN properties.source_import IS 'crexi | om | null (manual)';
COMMENT ON COLUMN properties.highlights IS 'Array of key selling point strings';
COMMENT ON COLUMN properties.publish_to_website IS 'Whether to show on stewardshipcre.com/properties';
