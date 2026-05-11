-- 0027_costar_full_extraction_columns.sql
--
-- Adds the columns CoStar already exports but we weren't capturing.
-- Column-header audit on first import revealed CoStar's actual schema
-- has ~280 columns. We were mapping ~25. This migration adds the
-- high-value ones so the importer can extract owner contact, loan,
-- performance, and listing data without paying a third-party vendor.
--
-- Applied via Supabase MCP on 2026-05-11.

-- Owner contact (CoStar pulls phone numbers in the export)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_phone text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS owner_contact_name text;

-- True Owner = CoStar's LLC unmask (the human/entity behind the LLC)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_owner_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_owner_phone text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_owner_contact_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_owner_address text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_owner_city text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_owner_state text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS true_owner_zip text;

-- Recorded owner (third name variant; usually the recorded deed)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS recorded_owner_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS recorded_owner_phone text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS recorded_owner_address text;

-- Loan / debt detail (Lane B is downstream of these)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS loan_interest_rate numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS loan_interest_rate_type text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS loan_type text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS loan_collateral_type text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS loan_originator text;

-- Performance signals
ALTER TABLE properties ADD COLUMN IF NOT EXISTS percent_leased numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS vacancy_pct numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS days_on_market integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS rent_per_sf_yr numeric;

-- Listing state
ALTER TABLE properties ADD COLUMN IF NOT EXISTS for_sale_price numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS for_sale_status text;

-- Building / market context
ALTER TABLE properties ADD COLUMN IF NOT EXISTS building_class text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS market_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS submarket text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS submarket_cluster text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS tenancy text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS total_buildings integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS number_of_stories integer;

-- Tax
ALTER TABLE properties ADD COLUMN IF NOT EXISTS tax_year integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS tax_total numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS tax_per_sf numeric;

-- Service contacts on CoStar's record
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_manager_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_manager_phone text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_manager_address text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sales_company_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sales_contact_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sales_contact_phone text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS leasing_company_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS leasing_contact_name text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS leasing_contact_phone text;

-- Hospitality-specific
ALTER TABLE properties ADD COLUMN IF NOT EXISTS rooms integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS hotel_brand text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS hotel_class text;

-- Geographic precision (CoStar gives lat/lon)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS latitude numeric;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS longitude numeric;

CREATE INDEX IF NOT EXISTS properties_for_sale_status_idx
  ON properties(organization_id, for_sale_status)
  WHERE for_sale_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS properties_true_owner_state_idx
  ON properties(organization_id, true_owner_state)
  WHERE true_owner_state IS NOT NULL;
