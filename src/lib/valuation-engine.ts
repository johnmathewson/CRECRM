/**
 * Valuation Engine — CRE property valuation using John Mathewson's methodology.
 *
 * Workflow: Geocode subject → Pull nearby comps → Run analysis → Generate reports
 *
 * Methodology by asset type:
 * - Retail/Office/Industrial: Income approach (NOI ÷ cap rate), validated by sales comps
 * - Land: Comp-only (no income)
 * - Multifamily: Income approach, cap rate driven, lease comps for rent analysis
 * - Value-add: Dual presentation (as-is + pro forma)
 */

import { createClient } from "@supabase/supabase-js";
import { geocodeAddress, GeocodedAddress } from "./geocoder";

// ── Types ──────────────────────────────────────────────────

export interface ValuationRequest {
  /** Display address. Optional when latitude+longitude are provided
   *  (vacant land, addressless parcels — caller drops a pin instead). */
  address?: string;
  /** Direct spatial anchor — skips geocoding entirely. Preferred over
   *  address when both are present (broker's map pin is more accurate
   *  than a string lookup). */
  latitude?: number;
  longitude?: number;
  /** Assessor parcel number. Saved to the property record if the
   *  valuation is promoted, not used for the comp lookup itself. */
  apn?: string;
  assetType?: string;
  sqft?: number;
  yearBuilt?: number;
  units?: {
    name: string;
    sqft: number;
    tenant?: string | null;
    isVacant?: boolean;
    leaseRate?: number | null;
    monthlyRent?: number | null;
    annualRent?: number | null;
  }[];
  // Optional income data (if owner provides it)
  annualIncome?: number;
  annualExpenses?: number;
  occupancyPct?: number;
  // Contact info for lead capture
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface NearbyComp {
  comp_type: string;
  comp_id: string;
  address: string;
  city: string;
  state: string;
  asset_type: string;
  distance_miles: number;
  sale_price: number | null;
  price_per_sqft: number | null;
  cap_rate: number | null;
  sale_date: string | null;
  buyer: string | null;
  seller: string | null;
  year_built: number | null;
  tenant_name: string | null;
  rent_per_sqft: number | null;
  lease_type: string | null;
  lease_date: string | null;
  term_months: number | null;
  sqft: number | null;
  acreage: number | null;
  notes: string | null;
}

export interface ValuationResult {
  subject: {
    address: string;
    geocoded: GeocodedAddress;
    assetType: string;
    sqft: number | null;
    yearBuilt: number | null;
  };
  comps: {
    saleComps: NearbyComp[];
    leaseComps: NearbyComp[];
    radiusMiles: number;
    totalFound: number;
  };
  methodology: string;
  incomeApproach: {
    available: boolean;
    estimatedMarketRent?: number;
    estimatedNOI?: number;
    capRateRange: { low: number; mid: number; high: number };
    valueRange?: { low: number; mid: number; high: number };
  } | null;
  salesComparison: {
    available: boolean;
    pricePsfRange?: { low: number; mid: number; high: number };
    valueRange?: { low: number; mid: number; high: number };
    avgCapRate?: number;
  } | null;
  reconciledValue: {
    low: number;
    mid: number;
    high: number;
    confidence: "high" | "medium" | "low";
    basis: string;
  } | null;
  narrative: string;
  disclaimers: string[];
  leadId?: string;
}

// ── Cap Rate Tables (NWI Market) ───────────────────────────
// Based on John Mathewson's methodology for Northwest Indiana

interface CapRateRange {
  low: number;
  mid: number;
  high: number;
}

function getCapRateRange(assetType: string, occupancy?: number): CapRateRange {
  const type = (assetType || "").toLowerCase();

  if (type.includes("retail")) {
    // Retail: 7.5–10%. NNN + credit anchor → 7.5–8%, mom-and-pop → 9–10%
    return { low: 0.075, mid: 0.085, high: 0.10 };
  }
  if (type.includes("industrial") || type.includes("flex")) {
    // Industrial: 7–9%. Credit tenant → 7–8%, local → 8.5%+
    return { low: 0.07, mid: 0.08, high: 0.09 };
  }
  if (type.includes("office") || type.includes("medical")) {
    // Office: 8–11%. Strong tenants → 8–9%, weaker → 10–11%
    return { low: 0.08, mid: 0.095, high: 0.11 };
  }
  if (type.includes("multifamily")) {
    // Multifamily Class C: 6–7% at 90%+ occupancy
    return { low: 0.06, mid: 0.065, high: 0.07 };
  }
  if (type.includes("hotel") || type.includes("hospitality")) {
    return { low: 0.08, mid: 0.095, high: 0.11 };
  }
  // Default / specialty
  return { low: 0.075, mid: 0.09, high: 0.10 };
}

// ── Adjustment Factors ─────────────────────────────────────
// Ranked by importance: (1) Lease term, (2) Occupancy, (3) Tenant quality,
// (4) Deferred maintenance, (5) Traffic/visibility

function adjustCapRate(
  baseCapRate: number,
  occupancy?: number,
  isValueAdd?: boolean,
): number {
  let adjusted = baseCapRate;

  // Occupancy adjustment
  if (occupancy != null) {
    if (occupancy >= 95) adjusted -= 0.005; // Premium for fully leased
    else if (occupancy < 70) adjusted += 0.015; // Penalty for high vacancy
    else if (occupancy < 85) adjusted += 0.005; // Slight penalty
  }

  // Value-add premium (higher cap = lower price for upside)
  if (isValueAdd) adjusted += 0.01;

  return Math.max(0.05, Math.min(0.15, adjusted)); // Clamp 5-15%
}

// ── Comp Analysis Helpers ──────────────────────────────────

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function trimmedRange(values: number[]): { low: number; mid: number; high: number } | null {
  if (values.length < 1) return null;
  const sorted = [...values].sort((a, b) => a - b);
  // Trim outliers if we have enough data
  const trimmed = sorted.length > 4 ? sorted.slice(1, -1) : sorted;
  return {
    low: Math.round(trimmed[0] * 100) / 100,
    mid: Math.round(median(trimmed) * 100) / 100,
    high: Math.round(trimmed[trimmed.length - 1] * 100) / 100,
  };
}

// ── Methodology Selection ──────────────────────────────────

function selectMethodology(assetType: string): string {
  const type = (assetType || "").toLowerCase();
  if (type.includes("land")) return "sales-comparison-only";
  return "income-validated-by-comps"; // All other types
}

// ── Main Valuation Function ────────────────────────────────

export async function runValuation(
  request: ValuationRequest,
  supabaseUrl?: string,
  supabaseKey?: string,
): Promise<ValuationResult> {
  const url = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = supabaseKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createClient(url, key);

  // 1. Resolve the spatial anchor — prefer the explicit lat/lng
  // (broker dropped a pin) over geocoding the address. This lets
  // vacant land and addressless parcels run a valuation without
  // depending on the geocoder. The synthesized `geocoded` object
  // mirrors the geocodeAddress() shape so the rest of the engine
  // doesn't need to branch.
  let geocoded: NonNullable<Awaited<ReturnType<typeof geocodeAddress>>>;
  if (
    typeof request.latitude === "number" &&
    typeof request.longitude === "number" &&
    Number.isFinite(request.latitude) &&
    Number.isFinite(request.longitude)
  ) {
    geocoded = {
      lat: request.latitude,
      lng: request.longitude,
      formattedAddress:
        request.address?.trim() || `${request.latitude.toFixed(5)}, ${request.longitude.toFixed(5)}`,
      city: "",
      state: "",
      zip: "",
      county: "",
    };
  } else {
    if (!request.address || !request.address.trim()) {
      throw new Error("Either an address or latitude+longitude must be provided.");
    }
    const g = await geocodeAddress(request.address);
    if (!g) {
      throw new Error(`Could not geocode address: ${request.address}`);
    }
    geocoded = g;
  }

  const assetType = request.assetType || "Retail";
  const methodology = selectMethodology(assetType);

  // 2. Pull nearby comps via PostGIS function
  let radiusMiles = 3;
  let comps: NearbyComp[] = [];

  // Try 3 miles first, expand if sparse
  for (const radius of [3, 5, 10]) {
    const { data, error } = await supabase.rpc("find_nearby_comps", {
      p_lat: geocoded.lat,
      p_lng: geocoded.lng,
      p_radius_miles: radius,
      p_asset_type: methodology === "sales-comparison-only" ? null : assetType,
      p_limit: 50,
    });

    if (!error && data && data.length >= 3) {
      comps = data;
      radiusMiles = radius;
      break;
    }
    comps = data || [];
    radiusMiles = radius;
  }

  // If asset type filter is too restrictive, try without it
  if (comps.length < 3) {
    const { data } = await supabase.rpc("find_nearby_comps", {
      p_lat: geocoded.lat,
      p_lng: geocoded.lng,
      p_radius_miles: 10,
      p_asset_type: null,
      p_limit: 50,
    });
    if (data && data.length > comps.length) {
      comps = data;
      radiusMiles = 10;
    }
  }

  const saleComps = comps.filter((c) => c.comp_type === "sale");
  const leaseComps = comps.filter((c) => c.comp_type === "lease");

  // 3. Sales comparison analysis
  const compsWithPrice = saleComps.filter((c) => c.price_per_sqft && c.price_per_sqft > 0);
  const compsWithCap = saleComps.filter((c) => c.cap_rate && c.cap_rate > 0);
  const pricePsfValues = compsWithPrice.map((c) => c.price_per_sqft!);
  const capRateValues = compsWithCap.map((c) => c.cap_rate!);

  const pricePsfRange = trimmedRange(pricePsfValues);
  const avgCompCapRate = capRateValues.length > 0 ? median(capRateValues) : null;

  let salesComparisonValue: { low: number; mid: number; high: number } | null = null;
  if (pricePsfRange && request.sqft) {
    salesComparisonValue = {
      low: Math.round(pricePsfRange.low * request.sqft),
      mid: Math.round(pricePsfRange.mid * request.sqft),
      high: Math.round(pricePsfRange.high * request.sqft),
    };
  }

  const salesComparison = pricePsfRange
    ? {
        available: true,
        pricePsfRange,
        valueRange: salesComparisonValue || undefined,
        avgCapRate: avgCompCapRate || undefined,
      }
    : { available: false };

  // 4. Income approach (not for land)
  let incomeApproach: ValuationResult["incomeApproach"] = null;

  if (methodology !== "sales-comparison-only") {
    const capRange = getCapRateRange(assetType, request.occupancyPct);

    // Use actual market cap rate from comps if available
    if (avgCompCapRate) {
      capRange.mid = avgCompCapRate;
      capRange.low = Math.min(capRange.low, avgCompCapRate - 0.01);
      capRange.high = Math.max(capRange.high, avgCompCapRate + 0.01);
    }

    // Estimate market rent from lease comps or sale comp data
    let estimatedMarketRent: number | undefined;

    // If owner provided income, use it
    if (request.annualIncome) {
      const occupancy = request.occupancyPct ?? 90;
      const noi = request.annualIncome - (request.annualExpenses || request.annualIncome * 0.35);

      incomeApproach = {
        available: true,
        estimatedMarketRent: request.sqft ? request.annualIncome / request.sqft : undefined,
        estimatedNOI: noi,
        capRateRange: capRange,
        valueRange: {
          low: Math.round(noi / capRange.high),
          mid: Math.round(noi / capRange.mid),
          high: Math.round(noi / capRange.low),
        },
      };
    } else if (request.sqft && request.units) {
      // No income provided — estimate from market data
      // Use lease comps for rent estimate, or derive from sale comps
      const leaseRates = leaseComps
        .filter((c) => c.rent_per_sqft && c.rent_per_sqft > 0)
        .map((c) => c.rent_per_sqft!);

      if (leaseRates.length > 0) {
        estimatedMarketRent = median(leaseRates);
      } else if (pricePsfRange) {
        // Back into rent from price and cap rate
        // Price/SF = Rent/SF × (1 - expense ratio) / cap rate
        // So Rent/SF ≈ Price/SF × cap rate / (1 - expense ratio)
        const expenseRatio = 0.35;
        estimatedMarketRent = (pricePsfRange.mid * capRange.mid) / (1 - expenseRatio);
      }

      if (estimatedMarketRent) {
        const totalSF = request.units.reduce((s, u) => s + u.sqft, 0) || request.sqft;
        const occupancy = request.occupancyPct ?? 0.90;
        const grossIncome = estimatedMarketRent * totalSF * occupancy;
        const expenseRatio = 0.35; // Default for NWI
        const noi = grossIncome * (1 - expenseRatio);

        incomeApproach = {
          available: true,
          estimatedMarketRent: Math.round(estimatedMarketRent * 100) / 100,
          estimatedNOI: Math.round(noi),
          capRateRange: capRange,
          valueRange: {
            low: Math.round(noi / capRange.high),
            mid: Math.round(noi / capRange.mid),
            high: Math.round(noi / capRange.low),
          },
        };
      } else {
        incomeApproach = {
          available: false,
          capRateRange: capRange,
        };
      }
    } else {
      incomeApproach = {
        available: false,
        capRateRange: capRange,
      };
    }
  }

  // 5. Reconcile values
  let reconciledValue: ValuationResult["reconciledValue"] = null;

  const incomeValue = incomeApproach?.valueRange;
  const salesValue = salesComparison.available ? salesComparisonValue : null;

  if (incomeValue && salesValue) {
    // Both approaches available — per John: push the higher value with disclaimers,
    // but show both so the reader sees the gap
    reconciledValue = {
      low: Math.min(incomeValue.low, salesValue.low),
      mid: Math.round((incomeValue.mid + salesValue.mid) / 2),
      high: Math.max(incomeValue.high, salesValue.high),
      confidence: compsWithPrice.length >= 5 ? "high" : compsWithPrice.length >= 3 ? "medium" : "low",
      basis: "Income approach and sales comparison reconciled",
    };
  } else if (incomeValue) {
    reconciledValue = {
      ...incomeValue,
      confidence: "medium",
      basis: "Income approach (limited comparable sales data)",
    };
  } else if (salesValue) {
    reconciledValue = {
      ...salesValue,
      confidence: compsWithPrice.length >= 5 ? "high" : "medium",
      basis: methodology === "sales-comparison-only"
        ? "Sales comparison approach (land valuation)"
        : "Sales comparison approach (insufficient data for income analysis)",
    };
  }

  // 6. Build narrative
  const narrative = buildNarrative({
    assetType,
    geocoded,
    saleComps,
    leaseComps,
    pricePsfRange,
    avgCompCapRate,
    incomeApproach,
    reconciledValue,
    methodology,
    radiusMiles,
    sqft: request.sqft,
  });

  // 7. Build disclaimers
  const disclaimers = buildDisclaimers(methodology, compsWithPrice.length, assetType);

  // 8. Capture lead if contact info provided
  let leadId: string | undefined;
  if (request.contactEmail || request.contactPhone) {
    const { data } = await supabase
      .from("leads")
      .insert({
        organization_id: "a0000000-0000-0000-0000-000000000001",
        source: "valuation_agent",
        status: "new",
        notes: `Valuation request: ${request.address} (${assetType})${request.contactName ? ` — ${request.contactName}` : ""}${request.contactEmail ? ` — ${request.contactEmail}` : ""}${request.contactPhone ? ` — ${request.contactPhone}` : ""}`,
      })
      .select("id")
      .single();
    leadId = data?.id;
  }

  return {
    subject: {
      address: request.address ?? geocoded.formattedAddress,
      geocoded,
      assetType,
      sqft: request.sqft || null,
      yearBuilt: request.yearBuilt || null,
    },
    comps: {
      saleComps,
      leaseComps,
      radiusMiles,
      totalFound: comps.length,
    },
    methodology,
    incomeApproach,
    salesComparison,
    reconciledValue,
    narrative,
    disclaimers,
    leadId,
  };
}

// ── Narrative Builder ──────────────────────────────────────

function buildNarrative(params: {
  assetType: string;
  geocoded: GeocodedAddress;
  saleComps: NearbyComp[];
  leaseComps: NearbyComp[];
  pricePsfRange: { low: number; mid: number; high: number } | null;
  avgCompCapRate: number | null;
  incomeApproach: ValuationResult["incomeApproach"];
  reconciledValue: ValuationResult["reconciledValue"];
  methodology: string;
  radiusMiles: number;
  sqft?: number | null;
}): string {
  const parts: string[] = [];
  const { assetType, geocoded, saleComps, pricePsfRange, avgCompCapRate, incomeApproach, reconciledValue, radiusMiles } = params;

  // Market overview
  parts.push(
    `This Broker Opinion of Value analyzes the ${assetType.toLowerCase()} property located at ${geocoded.formattedAddress} in the ${geocoded.city}, ${geocoded.state} market.`,
  );

  // Comp summary
  const compsWithPrice = saleComps.filter((c) => c.sale_price && c.sale_price > 0);
  parts.push(
    `We identified ${saleComps.length} comparable ${assetType.toLowerCase()} sales within ${radiusMiles} miles, of which ${compsWithPrice.length} had reported sale prices.`,
  );

  // Sales comparison
  if (pricePsfRange) {
    parts.push(
      `Comparable sales indicate a price range of $${pricePsfRange.low.toFixed(2)} to $${pricePsfRange.high.toFixed(2)} per square foot, with a midpoint of $${pricePsfRange.mid.toFixed(2)} per square foot.`,
    );
  }

  // Cap rate
  if (avgCompCapRate) {
    parts.push(
      `Market capitalization rates from comparable transactions center around ${(avgCompCapRate * 100).toFixed(1)}%.`,
    );
  }

  // Income approach
  if (incomeApproach?.available && incomeApproach.estimatedMarketRent) {
    parts.push(
      `Based on market rent analysis, estimated achievable rent is approximately $${incomeApproach.estimatedMarketRent.toFixed(2)} per square foot annually.`,
    );
  }

  if (incomeApproach?.available && incomeApproach.estimatedNOI) {
    parts.push(
      `Projected Net Operating Income is approximately $${incomeApproach.estimatedNOI.toLocaleString()}.`,
    );
  }

  // Reconciled value
  if (reconciledValue) {
    const fmtV = (n: number) => {
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
      return `$${(n / 1e3).toFixed(0)}K`;
    };
    parts.push(
      `Based on our analysis, the estimated market value range is ${fmtV(reconciledValue.low)} to ${fmtV(reconciledValue.high)}, with a most probable value of ${fmtV(reconciledValue.mid)}.`,
    );
  }

  return parts.join(" ");
}

// ── Disclaimers ────────────────────────────────────────────

function buildDisclaimers(methodology: string, compCount: number, assetType: string): string[] {
  const disclaimers = [
    "This is a Broker Opinion of Value (BOV), not a formal appraisal. It is intended for informational purposes only and should not be relied upon as a substitute for an appraisal performed by a licensed appraiser.",
    "The values expressed herein are based on market data available at the time of analysis and are subject to change with market conditions.",
    "No liability is assumed for decisions made based on this opinion of value.",
  ];

  if (compCount < 3) {
    disclaimers.push(
      "Limited comparable sales data was available for this analysis. The value estimate should be considered preliminary and verified with additional market research.",
    );
  }

  if (methodology === "sales-comparison-only") {
    disclaimers.push(
      "This valuation model is based on comparable sales analysis only. Land valuation is inherently subjective and influenced by factors including zoning, entitlements, utilities, and development potential that may not be fully captured in this analysis.",
    );
  }

  const type = (assetType || "").toLowerCase();
  if (type.includes("land")) {
    disclaimers.push(
      "Land values can vary significantly based on environmental conditions, easements, and regulatory factors not considered in this analysis. A Phase I Environmental Assessment and title review are recommended prior to any transaction.",
    );
  }

  return disclaimers;
}
