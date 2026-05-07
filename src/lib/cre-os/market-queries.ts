/**
 * CRE OS — Market Intelligence data layer.
 *
 *   loadMarketSnapshot() → submarket activity + asset-class snapshot +
 *                          recent comp pulse + cap-rate trends
 *
 * Reads lease_comps + sale_comps. Aggregates into views the broker actually
 * uses ("what's happening in Lake County retail?"), not raw row counts.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { numOrNull, relativeTime } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export interface SubmarketRow {
  city: string;
  state: string;
  leaseCount: number;
  saleCount: number;
  /** Median asking rent across lease comps in this submarket ($/SF/yr) */
  medianRent: number | null;
  /** Median sale $/SF across sale comps */
  medianSalePsf: number | null;
  /** Median cap rate across sale comps that report it */
  medianCapRate: number | null;
}

export interface AssetClassSnapshot {
  assetType: string;
  leaseCount: number;
  saleCount: number;
  medianRent: number | null;
  rentRange: { low: number; high: number } | null;
  medianSalePsf: number | null;
  medianCapRate: number | null;
  /** Range across the trimmed comp set */
  capRateRange: { low: number; high: number } | null;
}

export interface CompPulseRow {
  id: string;
  type: "lease" | "sale";
  address: string;
  city: string;
  state: string;
  assetType: string | null;
  /** $/SF rent (annual) for lease comps; $/SF price for sale comps */
  rate: number | null;
  /** Cap rate for sale comps */
  capRate: number | null;
  sqft: number | null;
  date: string | null;
  when: string;
  notes: string | null;
}

export interface MarketSnapshot {
  submarkets: SubmarketRow[];
  assetClasses: AssetClassSnapshot[];
  recentComps: CompPulseRow[];
  totals: {
    leaseComps: number;
    saleComps: number;
    submarkets: number;
    medianRentAcrossPortfolio: number | null;
    medianCapRateAcrossPortfolio: number | null;
  };
  synthesis: string;
}

// ── Loader ────────────────────────────────────────────────────────────────
export async function loadMarketSnapshot(): Promise<MarketSnapshot> {
  const sb = createServerSupabase();

  const [{ data: leaseRows }, { data: saleRows }] = await Promise.all([
    sb.from("lease_comps")
      .select("id, address, city, state, asset_type, rent_per_sqft, sqft, lease_date, notes, created_at")
      .eq("organization_id", ORG_ID),
    sb.from("sale_comps")
      .select("id, address, city, state, asset_type, price_per_sqft, cap_rate, sqft, sale_date, notes, created_at")
      .eq("organization_id", ORG_ID),
  ]);

  const lease = (leaseRows ?? []) as any[];
  const sale = (saleRows ?? []) as any[];

  // ── Submarket aggregation (city + state) ──
  const submarketKey = (c: string, s: string) => `${c ?? ""}|${s ?? ""}`;
  const subBuckets = new Map<string, {
    city: string; state: string;
    leaseRents: number[]; salePsfs: number[]; capRates: number[];
    leaseCount: number; saleCount: number;
  }>();

  for (const r of lease) {
    if (!r.city) continue;
    const k = submarketKey(r.city, r.state);
    if (!subBuckets.has(k)) {
      subBuckets.set(k, {
        city: r.city, state: r.state ?? "",
        leaseRents: [], salePsfs: [], capRates: [],
        leaseCount: 0, saleCount: 0,
      });
    }
    const b = subBuckets.get(k)!;
    b.leaseCount += 1;
    const v = numOrNull(r.rent_per_sqft);
    if (v !== null && v > 0) b.leaseRents.push(v);
  }

  for (const r of sale) {
    if (!r.city) continue;
    const k = submarketKey(r.city, r.state);
    if (!subBuckets.has(k)) {
      subBuckets.set(k, {
        city: r.city, state: r.state ?? "",
        leaseRents: [], salePsfs: [], capRates: [],
        leaseCount: 0, saleCount: 0,
      });
    }
    const b = subBuckets.get(k)!;
    b.saleCount += 1;
    const psf = numOrNull(r.price_per_sqft);
    if (psf !== null && psf > 0) b.salePsfs.push(psf);
    const cap = numOrNull(r.cap_rate);
    if (cap !== null && cap > 0) b.capRates.push(cap);
  }

  const submarkets: SubmarketRow[] = Array.from(subBuckets.values())
    .map((b) => ({
      city: b.city,
      state: b.state,
      leaseCount: b.leaseCount,
      saleCount: b.saleCount,
      medianRent: median(b.leaseRents),
      medianSalePsf: median(b.salePsfs),
      medianCapRate: median(b.capRates),
    }))
    .sort((a, b) => (b.leaseCount + b.saleCount) - (a.leaseCount + a.saleCount));

  // ── Asset class snapshot ──
  const classBuckets = new Map<string, {
    leaseRents: number[]; salePsfs: number[]; capRates: number[];
    leaseCount: number; saleCount: number;
  }>();
  for (const r of lease) {
    const k = (r.asset_type ?? "").trim();
    if (!k) continue;
    if (!classBuckets.has(k)) classBuckets.set(k, { leaseRents: [], salePsfs: [], capRates: [], leaseCount: 0, saleCount: 0 });
    const b = classBuckets.get(k)!;
    b.leaseCount += 1;
    const v = numOrNull(r.rent_per_sqft);
    if (v !== null && v > 0) b.leaseRents.push(v);
  }
  for (const r of sale) {
    const k = (r.asset_type ?? "").trim();
    if (!k) continue;
    if (!classBuckets.has(k)) classBuckets.set(k, { leaseRents: [], salePsfs: [], capRates: [], leaseCount: 0, saleCount: 0 });
    const b = classBuckets.get(k)!;
    b.saleCount += 1;
    const psf = numOrNull(r.price_per_sqft);
    if (psf !== null && psf > 0) b.salePsfs.push(psf);
    const cap = numOrNull(r.cap_rate);
    if (cap !== null && cap > 0) b.capRates.push(cap);
  }
  const assetClasses: AssetClassSnapshot[] = Array.from(classBuckets.entries())
    .map(([assetType, b]) => ({
      assetType,
      leaseCount: b.leaseCount,
      saleCount: b.saleCount,
      medianRent: median(b.leaseRents),
      rentRange: b.leaseRents.length ? { low: Math.min(...b.leaseRents), high: Math.max(...b.leaseRents) } : null,
      medianSalePsf: median(b.salePsfs),
      medianCapRate: median(b.capRates),
      capRateRange: b.capRates.length ? { low: Math.min(...b.capRates), high: Math.max(...b.capRates) } : null,
    }))
    .sort((a, b) => (b.leaseCount + b.saleCount) - (a.leaseCount + a.saleCount));

  // ── Comp pulse — most recent across both tables ──
  const pulseLease: CompPulseRow[] = lease
    .map((r) => ({
      id: r.id,
      type: "lease" as const,
      address: r.address,
      city: r.city,
      state: r.state,
      assetType: r.asset_type,
      rate: numOrNull(r.rent_per_sqft),
      capRate: null,
      sqft: r.sqft ?? null,
      date: r.lease_date ?? r.created_at ?? null,
      when: relativeTime(r.lease_date ?? r.created_at ?? null),
      notes: r.notes,
    }));
  const pulseSale: CompPulseRow[] = sale
    .map((r) => ({
      id: r.id,
      type: "sale" as const,
      address: r.address,
      city: r.city,
      state: r.state,
      assetType: r.asset_type,
      rate: numOrNull(r.price_per_sqft),
      capRate: numOrNull(r.cap_rate),
      sqft: r.sqft ?? null,
      date: r.sale_date ?? r.created_at ?? null,
      when: relativeTime(r.sale_date ?? r.created_at ?? null),
      notes: r.notes,
    }));
  const recentComps = [...pulseLease, ...pulseSale]
    .sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())
    .slice(0, 12);

  // ── Portfolio-wide medians ──
  const allRents = lease.map((r) => numOrNull(r.rent_per_sqft)).filter((v): v is number => v !== null && v > 0);
  const allCaps = sale.map((r) => numOrNull(r.cap_rate)).filter((v): v is number => v !== null && v > 0);

  const synthesis = buildSynthesis(submarkets, assetClasses, lease.length, sale.length);

  return {
    submarkets,
    assetClasses,
    recentComps,
    totals: {
      leaseComps: lease.length,
      saleComps: sale.length,
      submarkets: submarkets.length,
      medianRentAcrossPortfolio: median(allRents),
      medianCapRateAcrossPortfolio: median(allCaps),
    },
    synthesis,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function buildSynthesis(
  submarkets: SubmarketRow[],
  classes: AssetClassSnapshot[],
  leaseN: number,
  saleN: number,
): string {
  if (leaseN + saleN === 0) {
    return "Comp database is empty. Import lease and sale comps to populate market intelligence.";
  }
  const bits: string[] = [];
  bits.push(`${leaseN} lease + ${saleN} sale comps across ${submarkets.length} submarket${submarkets.length === 1 ? "" : "s"}.`);

  // Highlight a notable submarket if it dominates
  const top = submarkets[0];
  if (top && (top.leaseCount + top.saleCount) >= 10) {
    if (top.medianRent !== null) {
      bits.push(`${top.city} leasing at ~$${top.medianRent.toFixed(2)}/SF.`);
    } else if (top.medianSalePsf !== null) {
      bits.push(`${top.city} sales at ~$${top.medianSalePsf.toFixed(0)}/SF.`);
    }
  }

  // Mention asset class with widest spread (suggests pricing tension)
  const widestRent = [...classes].filter((c) => c.rentRange).sort((a, b) => {
    const aSpread = a.rentRange ? a.rentRange.high - a.rentRange.low : 0;
    const bSpread = b.rentRange ? b.rentRange.high - b.rentRange.low : 0;
    return bSpread - aSpread;
  })[0];
  if (widestRent && widestRent.rentRange) {
    bits.push(`${capitalize(widestRent.assetType)} rent spread: $${widestRent.rentRange.low.toFixed(0)}–$${widestRent.rentRange.high.toFixed(0)}.`);
  }

  return bits.join(" ");
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
