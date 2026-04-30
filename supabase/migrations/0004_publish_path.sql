-- Migration 0004: Publish path — connect CRM listings to public marketing site.
-- Adds slug, headline, and image storage. Backfills slugs for existing rows.

-- ── Schema ──────────────────────────────────────────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS slug      text,
  ADD COLUMN IF NOT EXISTS headline  text,
  ADD COLUMN IF NOT EXISTS images    jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN properties.slug IS 'URL slug for public marketing site, e.g. "53-w-jefferson-joliet"';
COMMENT ON COLUMN properties.headline IS 'Marketing-friendly title for public site (separate from internal name)';
COMMENT ON COLUMN properties.images IS 'Array of {url, alt, order} objects. Stored in Supabase Storage bucket listing-images.';

-- ── Slug generator ──────────────────────────────────────────────────────────
-- Slugify text → lowercase, alphanumerics + hyphens only, collapse multiple
-- hyphens, trim ends. Pure SQL, no extensions required.
CREATE OR REPLACE FUNCTION slugify(input text) RETURNS text AS $$
DECLARE
  result text;
BEGIN
  IF input IS NULL OR length(trim(input)) = 0 THEN
    RETURN NULL;
  END IF;
  result := lower(input);
  result := regexp_replace(result, '[^a-z0-9]+', '-', 'g');
  result := regexp_replace(result, '-+', '-', 'g');
  result := trim(both '-' from result);
  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Build a slug from address + city, falling back to name.
-- Uniqueness is enforced via the unique index below; collisions get -2, -3, etc.
-- on insert (handled application-side).
CREATE OR REPLACE FUNCTION build_property_slug(
  p_address text,
  p_city    text,
  p_name    text
) RETURNS text AS $$
DECLARE
  base text;
BEGIN
  IF p_address IS NOT NULL AND p_city IS NOT NULL THEN
    base := slugify(p_address || ' ' || p_city);
  ELSIF p_address IS NOT NULL THEN
    base := slugify(p_address);
  ELSIF p_name IS NOT NULL THEN
    base := slugify(p_name);
  ELSE
    base := NULL;
  END IF;
  RETURN base;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── Backfill slugs for existing rows ────────────────────────────────────────
-- Two-pass: assign base slug, then resolve collisions by appending row id suffix.
DO $$
DECLARE
  r record;
  base_slug text;
  candidate text;
  n int;
BEGIN
  FOR r IN SELECT id, address, city, name FROM properties WHERE slug IS NULL LOOP
    base_slug := build_property_slug(r.address, r.city, r.name);
    IF base_slug IS NULL OR length(base_slug) = 0 THEN
      base_slug := 'property-' || substr(r.id::text, 1, 8);
    END IF;
    candidate := base_slug;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM properties WHERE slug = candidate AND id <> r.id) LOOP
      n := n + 1;
      candidate := base_slug || '-' || n;
    END LOOP;
    UPDATE properties SET slug = candidate WHERE id = r.id;
  END LOOP;
END $$;

-- ── Unique index on slug (after backfill so it doesn't fail) ────────────────
CREATE UNIQUE INDEX IF NOT EXISTS properties_slug_unique ON properties (slug)
  WHERE slug IS NOT NULL;

-- Public-site query index already exists from migration 0003
-- (idx_properties_publish_website). Extend it to include status filter
-- — public site shows available + pending + under_contract.
-- (No additional index needed; the existing one is fine for our query.)
