/**
 * CRE OS — Valuation page data layer.
 *
 *   loadValuateContext() → recent BOVs + portfolio cap-rate context.
 *
 * The valuation tool itself is a self-contained client component
 * (`ValuateContent`); this module just supplies the surrounding context
 * the CRE OS shell renders in the right rail and command-stat strip.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { numOrNull, relativeTime } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface RecentBov {
  id: string;
  name: string;
  headline: string | null;
  slug: string | null;
  city: string | null;
  state: string | null;
  assetType: string | null;
  askingPrice: number | null;
  sqft: number | null;
  noi: number | null;
  capRate: number | null;
  pricePerSf: number | null;
  createdAt: string | null;
  /** Human relative time: "3d ago" */
  when: string;
}

export interface ValuateContext {
  /** Most recent properties with valuation data on file. Drives the rail. */
  recentBovs: RecentBov[];
  /** Coarse market context for the command-stat strip. */
  totals: {
    portfolioMedianCapRate: number | null;
    portfolioMedianPpsf: number | null;
    saleCompCount: number;
    leaseCompCount: number;
  };
}

export async function loadValuateContext(): Promise<ValuateContext> {
  const sb = createServerSupabase();

  // "Has valuation data" = at least one of asking_price, NOI, or cap_rate
  // is populated. That's a reasonable proxy for "this property has been
  // through the BOV tool recently."
  const [{ data: propRows }, { data: saleRows }, { data: leaseRows }] = await Promise.all([
    sb.from("properties")
      .select("id, name, headline, slug, city, state, asset_type, asking_price, sqft, noi, cap_rate, price_per_sf, created_at")
      .eq("organization_id", ORG_ID)
      .or("asking_price.not.is.null,noi.not.is.null,cap_rate.not.is.null")
      .order("created_at", { ascending: false })
      .limit(8),
    sb.from("sale_comps")
      .select("price_per_sqft, cap_rate")
      .eq("organization_id", ORG_ID),
    sb.from("lease_comps")
      .select("id")
      .eq("organization_id", ORG_ID),
  ]);

  const recentBovs: RecentBov[] = ((propRows ?? []) as any[]).map((p) => ({
    id: p.id,
    name: p.name,
    headline: p.headline,
    slug: p.slug,
    city: p.city,
    state: p.state,
    assetType: p.asset_type,
    askingPrice: numOrNull(p.asking_price),
    sqft: p.sqft ?? null,
    noi: numOrNull(p.noi),
    capRate: numOrNull(p.cap_rate),
    pricePerSf: numOrNull(p.price_per_sf),
    createdAt: p.created_at,
    when: relativeTime(p.created_at ?? null),
  }));

  const sale = (saleRows ?? []) as any[];
  const ppsfList = sale.map((r) => numOrNull(r.price_per_sqft)).filter((v): v is number => v !== null && v > 0);
  const capList = sale.map((r) => numOrNull(r.cap_rate)).filter((v): v is number => v !== null && v > 0);

  return {
    recentBovs,
    totals: {
      portfolioMedianCapRate: median(capList),
      portfolioMedianPpsf: median(ppsfList),
      saleCompCount: sale.length,
      leaseCompCount: (leaseRows ?? []).length,
    },
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
