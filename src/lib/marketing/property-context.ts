/**
 * Property marketing context — the data blob every marketing generator
 * (description, headline, flyer, OM, social) consumes.
 *
 * Shared across all marketing assets so we pull the same comps + voice
 * once and pass the resolved context to whichever asset is being
 * generated. Reusing the blob keeps each asset's view of the property
 * consistent — flyer numbers match description numbers match OM numbers.
 *
 * Returns:
 *   - property: every column on properties (raw row, not type-narrowed)
 *   - saleComps: up to 10 recent sales in the same city + asset_type
 *   - leaseComps: up to 10 recent leases in the same city + asset_type
 *   - voiceProfile: John's broker voice rules
 *   - computed: derived signals (price/SF, building age, vintage band, etc.)
 *
 * The comp filters are intentionally loose for first ship — same city +
 * same asset_type + last 36 months. A future submarket-aware version
 * can use the submarket_id or geographic radius once we have lat/long
 * on more properties.
 */

import { createClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

export interface MarketingPropertyContext {
  property: AnyRow;
  saleComps: AnyRow[];
  leaseComps: AnyRow[];
  voiceProfile: AnyRow | null;
  computed: {
    pricePerSf: number | null;
    buildingAge: number | null;
    vintageBand: string | null;
    saleCompMedianPpsf: number | null;
    saleCompMedianCap: number | null;
    leaseCompMedianRent: number | null;
    saleCompCount: number;
    leaseCompCount: number;
  };
}

export async function loadPropertyMarketingContext(propertyId: string): Promise<MarketingPropertyContext | null> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: property, error: propErr } = await sb
    .from("properties")
    .select("*")
    .eq("organization_id", ORG_ID)
    .eq("id", propertyId)
    .maybeSingle();

  if (propErr || !property) return null;

  // Case-insensitive match on city + asset_type. The properties table
  // and the comp tables don't share a casing convention — properties
  // stores "MERRILLVILLE" + "industrial", while comps store
  // "Merrillville" + "Industrial". `.eq()` is case-sensitive and was
  // silently dropping every comp. `.ilike()` fixes that.
  //
  // The date filter is intentionally NOT applied at the query level
  // anymore: lease_comps in particular have null lease_date for many
  // rows, and a `.gte` against null is false — excluding good comps.
  // Instead we order by date desc (nulls last) and take the top 10,
  // which is effectively "most recent comps, including undated ones
  // if recents are thin."
  const city = property.city ?? "__none__";
  const assetType = property.asset_type ?? "__none__";

  const [saleRes, leaseRes, voiceRes] = await Promise.all([
    sb
      .from("sale_comps")
      .select(
        "id, address, city, state, asset_type, sale_date, sale_price, price_per_sqft, cap_rate, sqft, year_built, buyer, seller, notes"
      )
      .eq("organization_id", ORG_ID)
      .ilike("city", city)
      .ilike("asset_type", assetType)
      .order("sale_date", { ascending: false, nullsFirst: false })
      .limit(10),
    sb
      .from("lease_comps")
      .select(
        "id, address, city, state, asset_type, tenant_name, lease_date, rent_per_sqft, sqft, lease_type, term_months, notes"
      )
      .eq("organization_id", ORG_ID)
      .ilike("city", city)
      .ilike("asset_type", assetType)
      .order("lease_date", { ascending: false, nullsFirst: false })
      .limit(10),
    sb
      .from("broker_voice_profile")
      .select("brand_voice, pet_phrases, banned_phrases, always_do, never_do, sign_off_default, bio")
      .eq("organization_id", ORG_ID)
      .maybeSingle(),
  ]);

  const saleComps = saleRes.data ?? [];
  const leaseComps = leaseRes.data ?? [];

  const computed = buildComputed(property, saleComps, leaseComps);

  return {
    property,
    saleComps,
    leaseComps,
    voiceProfile: voiceRes.data ?? null,
    computed,
  };
}

function buildComputed(p: AnyRow, sales: AnyRow[], leases: AnyRow[]) {
  const pricePerSf =
    p.asking_price && p.sqft && p.sqft > 0 ? Number(p.asking_price) / Number(p.sqft) : null;

  const currentYear = 2026;
  const buildingAge = p.year_built ? currentYear - Number(p.year_built) : null;

  let vintageBand: string | null = null;
  if (buildingAge !== null) {
    if (buildingAge < 5) vintageBand = "brand-new";
    else if (buildingAge < 15) vintageBand = "modern";
    else if (buildingAge < 30) vintageBand = "established";
    else if (buildingAge < 50) vintageBand = "vintage";
    else vintageBand = "legacy";
  }

  const median = (xs: number[]): number | null => {
    const valid = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (valid.length === 0) return null;
    const mid = Math.floor(valid.length / 2);
    return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
  };

  return {
    pricePerSf,
    buildingAge,
    vintageBand,
    saleCompMedianPpsf: median(sales.map((s) => Number(s.price_per_sqft))),
    saleCompMedianCap: median(sales.map((s) => Number(s.cap_rate))),
    leaseCompMedianRent: median(leases.map((l) => Number(l.rent_per_sqft))),
    saleCompCount: sales.length,
    leaseCompCount: leases.length,
  };
}
