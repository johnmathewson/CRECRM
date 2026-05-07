/**
 * CRE OS — Listing performance data layer.
 *
 *   loadListingPerformance(propertyId) → funnel + source comparison + named
 *                                         buyer engagement + anomaly flags
 *
 * Reads from listing_metrics (week-bucketed funnel) and crexi_leads_state
 * (per-buyer engagement tracked by the Chrome extension's CREXi sync).
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { numOrNull, relativeTime } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export interface FunnelStage {
  key: "impressions" | "page_views" | "unique_visitors" | "inquiries" | "opened_oms" | "executed_cas" | "offers";
  label: string;
  /** Cumulative count for this period across all sources */
  value: number;
  /** Conversion from previous stage as a fraction (0-1), null when no upstream */
  conversionFromPrior: number | null;
}

export interface SourcePerformance {
  source: string;          // "crexi" / "loopnet"
  impressions: number;
  pageViews: number;
  uniqueVisitors: number;
  inquiries: number;
  openedOms: number;
  executedCas: number;
  offers: number;
  /** Inquiries-to-impressions, as a percentage */
  conversionPct: number | null;
  /** Most-recent scrape time for this source */
  lastSyncedAt: string | null;
}

export interface NamedBuyer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  levelOfInterest: string | null;
  numberOfVisits: number | null;
  lastActivityDate: string | null;
  lastActivityWhen: string;
  contactId: string | null;
  leadId: string | null;
}

export interface PerformanceAnomaly {
  id: string;
  /** Short headline that reads like "CREXi outperforming LoopNet 60×" */
  headline: string;
  caption: string;
  tone: "coral" | "amber" | "teal" | "neutral";
}

export interface ListingPerformance {
  /** Whether ANY metrics exist for this property */
  hasData: boolean;
  /** Latest period covered (YYYY-MM-DD) */
  latestPeriodEnd: string | null;
  latestPeriodStart: string | null;
  /** Aggregate funnel for the most-recent period */
  funnel: FunnelStage[];
  /** Per-source breakdown for the most-recent period */
  sources: SourcePerformance[];
  /** Period-over-period comparison (latest vs previous) */
  prior: {
    impressions: number;
    pageViews: number;
    inquiries: number;
    openedOms: number;
  } | null;
  /** Named buyers tracked on CREXi (level_of_interest, visits, last activity) */
  namedBuyers: NamedBuyer[];
  /** Synthesized anomaly callouts */
  anomalies: PerformanceAnomaly[];
}

// ── Loader ────────────────────────────────────────────────────────────────
export async function loadListingPerformance(propertyId: string): Promise<ListingPerformance> {
  const sb = createServerSupabase();

  const [{ data: metrics }, { data: buyers }] = await Promise.all([
    sb.from("listing_metrics")
      .select("source, period_start, period_end, impressions, page_views, unique_visitors, views, saves, inquiries, opened_oms, executed_cas, nda_executions, offers, downloads, scraped_at")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .order("period_end", { ascending: false }),
    sb.from("crexi_leads_state")
      .select("id, name, email, phone, company, role, level_of_interest, number_of_visits, last_activity_date, contact_id, lead_id")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .order("last_activity_date", { ascending: false, nullsFirst: false })
      .limit(50),
  ]);

  const rows = (metrics ?? []) as any[];

  if (rows.length === 0) {
    return {
      hasData: false,
      latestPeriodEnd: null,
      latestPeriodStart: null,
      funnel: emptyFunnel(),
      sources: [],
      prior: null,
      namedBuyers: [],
      anomalies: [],
    };
  }

  // Group by period — newest first; keep most-recent and the one before it
  const byPeriod = new Map<string, any[]>();
  for (const r of rows) {
    const k = r.period_end;
    if (!byPeriod.has(k)) byPeriod.set(k, []);
    byPeriod.get(k)!.push(r);
  }
  const periodKeys = Array.from(byPeriod.keys()).sort().reverse();
  const latestKey = periodKeys[0];
  const priorKey = periodKeys[1] ?? null;

  const latest = byPeriod.get(latestKey) ?? [];
  const priorRows = priorKey ? byPeriod.get(priorKey) ?? [] : [];
  const latestStart = latest[0]?.period_start ?? null;

  // Aggregate latest period across sources
  const totals = sumFunnel(latest);
  const priorTotals = sumFunnel(priorRows);

  // Build funnel with conversion rates between adjacent stages
  const funnel = buildFunnel(totals);

  // Per-source breakdown for the latest period only
  const sources: SourcePerformance[] = latest.map((r) => {
    const impressions = r.impressions ?? 0;
    const inquiries = r.inquiries ?? 0;
    const conversionPct = impressions > 0 ? (inquiries / impressions) * 100 : null;
    return {
      source: r.source ?? "unknown",
      impressions,
      pageViews: r.page_views ?? r.views ?? 0,
      uniqueVisitors: r.unique_visitors ?? 0,
      inquiries,
      openedOms: r.opened_oms ?? 0,
      executedCas: r.executed_cas ?? r.nda_executions ?? 0,
      offers: r.offers ?? 0,
      conversionPct,
      lastSyncedAt: r.scraped_at ?? null,
    };
  }).sort((a, b) => b.impressions - a.impressions);

  // Named buyer rows
  const namedBuyers: NamedBuyer[] = ((buyers ?? []) as any[]).map((b) => ({
    id: b.id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    company: b.company,
    role: b.role,
    levelOfInterest: b.level_of_interest,
    numberOfVisits: numOrNull(b.number_of_visits),
    lastActivityDate: b.last_activity_date,
    lastActivityWhen: relativeTime(b.last_activity_date),
    contactId: b.contact_id,
    leadId: b.lead_id,
  }));

  return {
    hasData: true,
    latestPeriodEnd: latestKey,
    latestPeriodStart: latestStart,
    funnel,
    sources,
    prior: priorTotals
      ? {
          impressions: priorTotals.impressions,
          pageViews: priorTotals.pageViews,
          inquiries: priorTotals.inquiries,
          openedOms: priorTotals.openedOms,
        }
      : null,
    namedBuyers,
    anomalies: synthesizeAnomalies(sources, totals, priorTotals, namedBuyers),
  };
}

// ── Funnel helpers ────────────────────────────────────────────────────────
interface FunnelTotals {
  impressions: number;
  pageViews: number;
  uniqueVisitors: number;
  inquiries: number;
  openedOms: number;
  executedCas: number;
  offers: number;
}

function sumFunnel(rows: any[]): FunnelTotals {
  return rows.reduce<FunnelTotals>(
    (acc, r) => ({
      impressions:    acc.impressions    + (r.impressions    ?? 0),
      pageViews:      acc.pageViews      + (r.page_views     ?? r.views ?? 0),
      uniqueVisitors: acc.uniqueVisitors + (r.unique_visitors?? 0),
      inquiries:      acc.inquiries      + (r.inquiries      ?? 0),
      openedOms:      acc.openedOms      + (r.opened_oms     ?? 0),
      executedCas:    acc.executedCas    + (r.executed_cas   ?? r.nda_executions ?? 0),
      offers:         acc.offers         + (r.offers         ?? 0),
    }),
    { impressions: 0, pageViews: 0, uniqueVisitors: 0, inquiries: 0, openedOms: 0, executedCas: 0, offers: 0 },
  );
}

function buildFunnel(t: FunnelTotals): FunnelStage[] {
  const stages: FunnelStage[] = [
    { key: "impressions",     label: "Impressions",     value: t.impressions,     conversionFromPrior: null },
    { key: "page_views",      label: "Page views",      value: t.pageViews,       conversionFromPrior: t.impressions > 0 ? t.pageViews / t.impressions : null },
    { key: "unique_visitors", label: "Unique visitors", value: t.uniqueVisitors,  conversionFromPrior: t.pageViews > 0 ? t.uniqueVisitors / t.pageViews : null },
    { key: "inquiries",       label: "Inquiries",       value: t.inquiries,       conversionFromPrior: t.uniqueVisitors > 0 ? t.inquiries / t.uniqueVisitors : (t.pageViews > 0 ? t.inquiries / t.pageViews : null) },
    { key: "opened_oms",      label: "OM opens",        value: t.openedOms,       conversionFromPrior: t.inquiries > 0 ? t.openedOms / t.inquiries : null },
    { key: "executed_cas",    label: "CAs executed",    value: t.executedCas,     conversionFromPrior: t.openedOms > 0 ? t.executedCas / t.openedOms : null },
    { key: "offers",          label: "Offers",          value: t.offers,          conversionFromPrior: t.executedCas > 0 ? t.offers / t.executedCas : null },
  ];
  return stages;
}

function emptyFunnel(): FunnelStage[] {
  return buildFunnel({ impressions: 0, pageViews: 0, uniqueVisitors: 0, inquiries: 0, openedOms: 0, executedCas: 0, offers: 0 });
}

// ── Anomaly synthesis ─────────────────────────────────────────────────────
function synthesizeAnomalies(
  sources: SourcePerformance[],
  totals: FunnelTotals,
  prior: FunnelTotals | null,
  buyers: NamedBuyer[],
): PerformanceAnomaly[] {
  const out: PerformanceAnomaly[] = [];

  // Cross-platform spread
  if (sources.length >= 2) {
    const sorted = [...sources].sort((a, b) => b.impressions - a.impressions);
    const top = sorted[0];
    const second = sorted[1];
    if (top.impressions > 100 && second.impressions > 0) {
      const ratio = top.impressions / second.impressions;
      if (ratio >= 3) {
        out.push({
          id: "platform-spread",
          headline: `${capitalize(top.source)} outperforming ${capitalize(second.source)} ${ratio.toFixed(1)}×`,
          caption: `${top.impressions.toLocaleString()} impressions vs ${second.impressions.toLocaleString()}. Consider rebalancing marketing spend.`,
          tone: "teal",
        });
      }
    }
  }

  // High traffic, weak inquiry conversion
  if (totals.impressions >= 500 && totals.inquiries > 0) {
    const conversionPct = (totals.inquiries / totals.impressions) * 100;
    if (conversionPct < 1) {
      out.push({
        id: "weak-conversion",
        headline: "Strong traffic, thin inquiry conversion",
        caption: `${totals.impressions.toLocaleString()} impressions yielding only ${totals.inquiries} inquir${totals.inquiries === 1 ? "y" : "ies"} (${conversionPct.toFixed(2)}%). Pricing or positioning may be off.`,
        tone: "amber",
      });
    }
  }

  // High inquiries, low qualified action (OM opens)
  if (totals.inquiries >= 10 && totals.openedOms > 0) {
    const omRate = totals.openedOms / totals.inquiries;
    if (omRate < 0.3) {
      out.push({
        id: "weak-qualification",
        headline: "High inquiry volume, low OM engagement",
        caption: `${totals.inquiries} inquiries → ${totals.openedOms} OM opens (${(omRate * 100).toFixed(0)}%). Buyers may be browsing rather than serious.`,
        tone: "amber",
      });
    }
  }

  // Period-over-period drop
  if (prior && prior.impressions > 0 && totals.impressions > 0) {
    const change = (totals.impressions - prior.impressions) / prior.impressions;
    if (change <= -0.4) {
      out.push({
        id: "traffic-drop",
        headline: `Traffic down ${Math.round(Math.abs(change) * 100)}% week-over-week`,
        caption: `${prior.impressions.toLocaleString()} → ${totals.impressions.toLocaleString()} impressions. Worth checking for a price change or syndication issue.`,
        tone: "coral",
      });
    } else if (change >= 0.4) {
      out.push({
        id: "traffic-spike",
        headline: `Traffic up ${Math.round(change * 100)}% week-over-week`,
        caption: `${prior.impressions.toLocaleString()} → ${totals.impressions.toLocaleString()} impressions. Owner update recommended — demand quality just changed.`,
        tone: "teal",
      });
    }
  }

  // Warm-but-uncontacted named buyers
  const warmUncontacted = buyers.filter(
    (b) => (b.levelOfInterest === "Hot" || b.levelOfInterest === "Warm") && !b.contactId && (b.numberOfVisits ?? 0) >= 2,
  );
  if (warmUncontacted.length > 0) {
    out.push({
      id: "warm-uncontacted",
      headline: `${warmUncontacted.length} warm buyer${warmUncontacted.length === 1 ? "" : "s"} engaged 2+ times, not yet in CRM`,
      caption: "Names from the platform showing repeat engagement but not converted to a contact yet. Worth pulling into the relationships layer.",
      tone: "coral",
    });
  }

  // Offers landed
  if (totals.offers > 0) {
    out.push({
      id: "offers",
      headline: `${totals.offers} offer${totals.offers === 1 ? "" : "s"} on the table this period`,
      caption: "Late-funnel signal worth flagging to the owner immediately.",
      tone: "teal",
    });
  }

  return out.slice(0, 6);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}
