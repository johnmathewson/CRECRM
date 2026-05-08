/**
 * CRE OS — Reports data layer.
 *
 *   loadReportSnapshot() → pipeline forecast + closed YTD + lead funnel +
 *                          listing performance roll-up.
 *
 * Single round-trip aggregator. Everything aggregates server-side; the
 * view component is pure presentation. Mirrors the "command surface +
 * insights rail + AI synthesis" pattern of the other CRE OS pages.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { numOrNull } from "./time-utils";
import { normalizeStage, type StageKey } from "./stage-config";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export interface PipelineForecastRow {
  /** "2026-05" */
  month: string;
  monthLabel: string;            // "May 2026"
  activeCount: number;
  pipelineValue: number;
  weightedValue: number;
}

export interface StageDealPreview {
  id: string;
  dealName: string | null;
  propertyName: string | null;
  propertySlug: string | null;
  price: number | null;
  weightedCommission: number | null;
  probabilityPct: number | null;
  expectedClose: string | null;
  daysInStage: number | null;
}

export interface StageRollupRow {
  stage: StageKey;
  count: number;
  totalValue: number;
  weightedValue: number;
  avgProbability: number | null;
  /** Deals at this stage — used by the expandable row in the Reports view. */
  deals: StageDealPreview[];
}

export interface ClosedMonthRow {
  month: string;                 // "2026-04"
  monthLabel: string;             // "Apr"
  count: number;
  /** Total deal price (gross volume) closed in this month. */
  volume: number;
  /** Total weighted commission credited; NULL when commission rates aren't on record. */
  commission: number;
}

export interface LeadWeekRow {
  week: string;                  // "2026-W18"
  weekLabel: string;             // "May 4"
  weekStart: string;             // ISO date
  count: number;
}

export interface LeadSourceRow {
  source: string;
  count: number;
}

export interface ListingReachRow {
  propertyId: string;
  name: string;
  headline: string | null;
  slug: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  daysOnMarket: number | null;
  /** Last 7d totals, summed across crexi + loopnet + site. */
  reach7d: number;
  inquiries7d: number;
  ndaSignatures7d: number;
  omDownloads7d: number;
  /** "Hot" ratio: inquiries/reach × 1000 (i.e. inquiries per 1000 eyeballs). */
  conversionPer1k: number | null;
}

export interface ReportSnapshot {
  totals: {
    activeDeals: number;
    pipelineValue: number;
    weightedValue: number;
    expectedThisQuarter: number;
    wonYtdCount: number;
    wonYtdVolume: number;
    /** Commission actually earned on closed-won deals YTD — the "what I
     *  banked this year" number. Sums weighted_commission when set, falls
     *  back to price × commission_pct/100. */
    earnedYtd: number;
    leadsThisMonth: number;
    leadsLastMonth: number;
    activeListings: number;
  };
  forecast: PipelineForecastRow[];   // next 6 months by expected_close
  stageRollup: StageRollupRow[];     // active deals by current stage
  closedByMonth: ClosedMonthRow[];   // last 12 months
  leadsByWeek: LeadWeekRow[];        // last 8 weeks
  leadsBySource: LeadSourceRow[];    // last 90 days
  listingReach: ListingReachRow[];   // active listings, last 7d roll-up
  synthesis: string;
}

// ── Loader ────────────────────────────────────────────────────────────────
export async function loadReportSnapshot(): Promise<ReportSnapshot> {
  const sb = createServerSupabase();

  const now = new Date();
  const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const eightWeeksAgo = new Date(Date.now() - 8 * 7 * 86400000).toISOString();
  const monthsBack12 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();

  // Pull everything in parallel — each query is org-scoped + targeted at
  // a specific report section.
  const [activeDealsRes, closedDealsRes, leadsRes, listingsRes, listingMetricsRes, vaultRes, ndaRes] = await Promise.all([
    // Active deals + their current stage (for forecast + stage rollup).
    // Joining property so the stage drill-in can link to the workspace.
    sb.from("deals")
      .select(`
        id, deal_name, deal_type, price, weighted_commission, probability_pct,
        commission_pct, expected_close, is_closed, is_dead,
        property:properties(id, name, slug),
        deal_stages(stage, entered_at, exited_at)
      `)
      .eq("organization_id", ORG_ID)
      .eq("is_closed", false)
      .eq("is_dead", false),
    // Closed-won deals over the last 12 months
    sb.from("deals")
      .select("id, price, commission_pct, weighted_commission, actual_close")
      .eq("organization_id", ORG_ID)
      .eq("is_closed", true)
      .gte("actual_close", monthsBack12),
    // Leads — last 8 weeks for weekly, plus all-time source counts
    sb.from("leads")
      .select("id, source, status, created_at")
      .eq("organization_id", ORG_ID)
      .gte("created_at", eightWeeksAgo),
    // Active listings (the 4 properties at status in (listed, under_contract, pitched, prospecting))
    sb.from("properties")
      .select("id, name, headline, slug, city, state, status, created_at")
      .eq("organization_id", ORG_ID)
      .in("status", ["listed", "under_contract", "pitched", "prospecting"])
      .order("created_at", { ascending: false }),
    // Last 7d listing metrics (CREXi + LoopNet + Site)
    sb.from("listing_metrics")
      .select("property_id, source, period_start, period_end, views, page_views, inquiries, downloads, opened_oms, executed_cas")
      .eq("organization_id", ORG_ID)
      .gte("period_end", sevenDaysAgo),
    // Vault downloads in last 7d
    sb.from("vault_access_logs")
      .select("property_id, access_type, accessed_at")
      .eq("organization_id", ORG_ID)
      .in("access_type", ["download", "flyer_download"])
      .gte("accessed_at", sevenDaysAgo),
    // NDAs signed in last 7d
    sb.from("nda_signatures")
      .select("property_id, signed_at")
      .eq("organization_id", ORG_ID)
      .is("revoked_at", null)
      .gte("signed_at", sevenDaysAgo),
  ]);

  const activeDeals = (activeDealsRes.data ?? []) as any[];
  const closedDeals = (closedDealsRes.data ?? []) as any[];
  const leads = (leadsRes.data ?? []) as any[];
  const listings = (listingsRes.data ?? []) as any[];

  // ── Totals ──────────────────────────────────────────────────────────
  let pipelineValue = 0;
  let weightedValue = 0;
  let expectedThisQuarter = 0;
  const quarterEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 0));
  for (const d of activeDeals) {
    pipelineValue += Number(d.price) || 0;
    weightedValue += Number(d.weighted_commission) || 0;
    if (d.expected_close && new Date(d.expected_close) <= quarterEnd) {
      expectedThisQuarter += Number(d.weighted_commission) || 0;
    }
  }
  const wonYtdDeals = closedDeals.filter((d) => d.actual_close && new Date(d.actual_close) >= ytdStart);
  const wonYtdVolume = wonYtdDeals.reduce((s, d) => s + (Number(d.price) || 0), 0);
  // Earned YTD commission: prefer realized weighted_commission; fall back to
  // price × commission_pct/100 when weighted hasn't been set on the row.
  const earnedYtd = wonYtdDeals.reduce((s, d) => {
    if (d.weighted_commission !== null && d.weighted_commission !== undefined) {
      return s + Number(d.weighted_commission);
    }
    if (d.price !== null && d.commission_pct !== null && d.commission_pct !== undefined) {
      return s + (Number(d.price) * Number(d.commission_pct)) / 100;
    }
    return s;
  }, 0);

  const leadsThisMonth = leads.filter((l) => l.created_at >= thisMonthStart).length;
  const leadsLastMonth = leads.filter((l) =>
    l.created_at >= lastMonthStart && l.created_at < thisMonthStart
  ).length;

  // ── Pipeline forecast: next 6 months by expected_close ────────────
  const forecastMap = new Map<string, PipelineForecastRow>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    forecastMap.set(key, {
      month: key,
      monthLabel: label,
      activeCount: 0,
      pipelineValue: 0,
      weightedValue: 0,
    });
  }
  for (const d of activeDeals) {
    if (!d.expected_close) continue;
    const dt = new Date(d.expected_close);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    const row = forecastMap.get(key);
    if (!row) continue;
    row.activeCount += 1;
    row.pipelineValue += Number(d.price) || 0;
    row.weightedValue += Number(d.weighted_commission) || 0;
  }
  const forecast = Array.from(forecastMap.values());

  // ── Stage rollup: active deals by current stage ───────────────────
  const stageMap = new Map<StageKey, StageRollupRow>();
  for (const d of activeDeals) {
    const stages = (d.deal_stages ?? []) as any[];
    const active = stages.find((s) => !s.exited_at) ??
                   stages.sort((a, b) => (b.entered_at ?? "").localeCompare(a.entered_at ?? ""))[0];
    const stage = normalizeStage(active?.stage);
    const enteredAt = active?.entered_at ?? null;
    const daysInStage = enteredAt
      ? Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86400000)
      : null;

    // Property join may be an array (Supabase 1:1 FK quirk) or single row.
    const propertyRel = Array.isArray(d.property) ? d.property[0] : d.property;

    const row = stageMap.get(stage) ?? {
      stage,
      count: 0,
      totalValue: 0,
      weightedValue: 0,
      avgProbability: null,
      deals: [] as StageDealPreview[],
    };
    row.count += 1;
    row.totalValue += Number(d.price) || 0;
    row.weightedValue += Number(d.weighted_commission) || 0;
    row.deals.push({
      id: d.id,
      dealName: d.deal_name ?? null,
      propertyName: propertyRel?.name ?? null,
      propertySlug: propertyRel?.slug ?? null,
      price: numOrNull(d.price),
      weightedCommission: numOrNull(d.weighted_commission),
      probabilityPct: numOrNull(d.probability_pct),
      expectedClose: d.expected_close ?? null,
      daysInStage,
    });
    stageMap.set(stage, row);
  }
  // Sort deals within each stage: stalest first (most days in stage), so
  // the broker sees what's been sitting longest when they expand.
  for (const row of Array.from(stageMap.values())) {
    row.deals.sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
  }
  // Compute avg probability per stage
  const stageProbabilitySums: Record<string, { sum: number; n: number }> = {};
  for (const d of activeDeals) {
    if (d.probability_pct === null || d.probability_pct === undefined) continue;
    const stages = (d.deal_stages ?? []) as any[];
    const active = stages.find((s) => !s.exited_at) ??
                   stages.sort((a, b) => (b.entered_at ?? "").localeCompare(a.entered_at ?? ""))[0];
    const stage = normalizeStage(active?.stage);
    const acc = stageProbabilitySums[stage] ?? { sum: 0, n: 0 };
    acc.sum += Number(d.probability_pct);
    acc.n += 1;
    stageProbabilitySums[stage] = acc;
  }
  Array.from(stageMap.values()).forEach((row) => {
    const acc = stageProbabilitySums[row.stage];
    row.avgProbability = acc && acc.n > 0 ? acc.sum / acc.n : null;
  });
  const stageRollup = Array.from(stageMap.values()).sort(
    (a, b) => stageOrder(a.stage) - stageOrder(b.stage),
  );

  // ── Closed by month: last 12 months ───────────────────────────────
  const closedMap = new Map<string, ClosedMonthRow>();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    closedMap.set(key, { month: key, monthLabel: label, count: 0, volume: 0, commission: 0 });
  }
  for (const d of closedDeals) {
    if (!d.actual_close) continue;
    const dt = new Date(d.actual_close);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    const row = closedMap.get(key);
    if (!row) continue;
    row.count += 1;
    row.volume += Number(d.price) || 0;
    // Earned commission: prefer weighted_commission (already realistic), fall
    // back to price × commission_pct/100 when weighted is null.
    const commission =
      d.weighted_commission !== null && d.weighted_commission !== undefined
        ? Number(d.weighted_commission)
        : d.commission_pct !== null && d.price !== null
          ? (Number(d.price) * Number(d.commission_pct)) / 100
          : 0;
    row.commission += commission;
  }
  const closedByMonth = Array.from(closedMap.values());

  // ── Leads by week + by source ─────────────────────────────────────
  const weeksMap = new Map<string, LeadWeekRow>();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(Date.now() - i * 7 * 86400000);
    const wk = isoWeek(d);
    const wkStart = startOfWeek(d);
    weeksMap.set(wk.iso, {
      week: wk.iso,
      weekLabel: wkStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      weekStart: wkStart.toISOString().slice(0, 10),
      count: 0,
    });
  }
  for (const l of leads) {
    const wk = isoWeek(new Date(l.created_at));
    const row = weeksMap.get(wk.iso);
    if (row) row.count += 1;
  }
  const leadsByWeek = Array.from(weeksMap.values());

  // Source counts — use leads in the last 90 days from the 8-week pull
  // when possible, else widen with a separate query. For now we use the
  // 8-week pull (covers 56 days) which is close enough for the rollup.
  const sourceMap = new Map<string, number>();
  for (const l of leads) {
    const src = (l.source || "other").trim();
    sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
  }
  const leadsBySource = Array.from(sourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  // ── Listing reach: per active listing, last-7d roll-up ────────────
  const metricsByProp = new Map<string, any[]>();
  for (const m of (listingMetricsRes.data ?? []) as any[]) {
    const list = metricsByProp.get(m.property_id) ?? [];
    list.push(m);
    metricsByProp.set(m.property_id, list);
  }
  const downloadsByProp = new Map<string, number>();
  for (const v of (vaultRes.data ?? []) as any[]) {
    downloadsByProp.set(v.property_id, (downloadsByProp.get(v.property_id) ?? 0) + 1);
  }
  const ndasByProp = new Map<string, number>();
  for (const n of (ndaRes.data ?? []) as any[]) {
    ndasByProp.set(n.property_id, (ndasByProp.get(n.property_id) ?? 0) + 1);
  }

  const listingReach: ListingReachRow[] = listings.map((p) => {
    const ms = metricsByProp.get(p.id) ?? [];
    const reach = ms.reduce((s, m) => s + (m.page_views ?? m.views ?? 0), 0);
    const inquiries = ms.reduce((s, m) => s + (m.inquiries ?? 0), 0);
    const omDownloads = (downloadsByProp.get(p.id) ?? 0) +
                        ms.reduce((s, m) => s + (m.opened_oms ?? m.downloads ?? 0), 0);
    const ndaSignatures = (ndasByProp.get(p.id) ?? 0) +
                          ms.reduce((s, m) => s + (m.executed_cas ?? 0), 0);

    const daysOnMarket = p.created_at
      ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000)
      : null;

    return {
      propertyId: p.id,
      name: p.name,
      headline: p.headline,
      slug: p.slug,
      city: p.city,
      state: p.state,
      status: p.status,
      daysOnMarket,
      reach7d: reach,
      inquiries7d: inquiries,
      ndaSignatures7d: ndaSignatures,
      omDownloads7d: omDownloads,
      conversionPer1k: reach > 0 ? Math.round((inquiries / reach) * 1000) : null,
    };
  });

  // ── Synthesis line ─────────────────────────────────────────────────
  const synthesis = buildSynthesis({
    activeDeals: activeDeals.length,
    pipelineValue,
    weightedValue,
    expectedThisQuarter,
    wonYtdCount: wonYtdDeals.length,
    wonYtdVolume,
    leadsThisMonth,
    leadsLastMonth,
  });

  return {
    totals: {
      activeDeals: activeDeals.length,
      pipelineValue,
      weightedValue,
      expectedThisQuarter,
      wonYtdCount: wonYtdDeals.length,
      wonYtdVolume,
      earnedYtd,
      leadsThisMonth,
      leadsLastMonth,
      activeListings: listings.length,
    },
    forecast,
    stageRollup,
    closedByMonth,
    leadsByWeek,
    leadsBySource,
    listingReach,
    synthesis,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function stageOrder(s: StageKey): number {
  const order: StageKey[] = [
    "Lead", "Prospecting", "Qualifying", "BOV", "Pre-listing",
    "Active Listing", "LOI", "Underwriting", "Due Diligence",
    "Financing", "Closing", "Post-close", "Closed",
  ];
  const idx = order.indexOf(s);
  return idx === -1 ? 99 : idx;
}

/** ISO week — "2026-W18" — used as a stable bucket key. */
function isoWeek(d: Date): { iso: string; year: number; week: number } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return {
    iso: `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    year: date.getUTCFullYear(),
    week,
  };
}

function startOfWeek(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = date.getUTCDay(); // 0=Sun
  const diff = (dow + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date;
}

function buildSynthesis(t: {
  activeDeals: number;
  pipelineValue: number;
  weightedValue: number;
  expectedThisQuarter: number;
  wonYtdCount: number;
  wonYtdVolume: number;
  leadsThisMonth: number;
  leadsLastMonth: number;
}): string {
  if (t.activeDeals === 0 && t.wonYtdCount === 0) {
    return "Reports will populate here as deals advance and leads come in.";
  }
  const parts: string[] = [];
  if (t.activeDeals > 0) {
    parts.push(`${t.activeDeals} active deal${t.activeDeals === 1 ? "" : "s"} worth $${fmtCompact(t.pipelineValue)} ($${fmtCompact(t.weightedValue)} weighted).`);
  }
  if (t.expectedThisQuarter > 0) {
    parts.push(`$${fmtCompact(t.expectedThisQuarter)} expected to close this quarter.`);
  }
  if (t.wonYtdCount > 0) {
    parts.push(`${t.wonYtdCount} closed YTD on $${fmtCompact(t.wonYtdVolume)} volume.`);
  }
  if (t.leadsThisMonth >= 0 && (t.leadsThisMonth > 0 || t.leadsLastMonth > 0)) {
    if (t.leadsLastMonth > 0) {
      const change = Math.round(((t.leadsThisMonth - t.leadsLastMonth) / t.leadsLastMonth) * 100);
      const direction = change >= 0 ? "↑" : "↓";
      parts.push(`${t.leadsThisMonth} leads this month (${direction}${Math.abs(change)}% vs last).`);
    } else {
      parts.push(`${t.leadsThisMonth} leads this month.`);
    }
  }
  return parts.join(" ");
}

function fmtCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(Math.round(n));
}
