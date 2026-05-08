/**
 * CRE OS — Listings command surface data layer.
 *
 *   loadListingsSnapshot() → roster of live listings + buy-side pursuits,
 *                            cross-listing hot buyers, anomaly callouts.
 *
 * Distinct from Properties (full inventory) and Pipeline (deals by stage).
 * This page answers "what's actively on market right now and how is it
 * pulling?" — the Monday-morning operational view.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { numOrNull } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export type ListingSide = "sell" | "buy";

export interface ListingCard {
  /** Stable id for keys — propertyId for sell-side, dealId-propertyId for buy-side. */
  cardId: string;
  side: ListingSide;
  propertyId: string;
  /** Sell-side: NULL. Buy-side: the deal id we're tracking the acquisition through. */
  dealId: string | null;

  name: string;
  headline: string | null;
  slug: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  assetType: string | null;
  status: string | null;
  transactionType: string | null;

  askingPrice: number | null;
  leaseRate: number | null;
  sqft: number | null;
  capRate: number | null;
  noi: number | null;

  heroImageUrl: string | null;

  /** Syndication URLs — null when not yet linked. */
  crexiUrl: string | null;
  loopnetUrl: string | null;
  /** Marketing site visibility: requires both publish=true AND a slug. */
  publishedToSite: boolean;

  daysOnMarket: number | null;

  /** Last 7d roll-up across CREXi + LoopNet + own site. */
  reach7d: number;
  inquiries7d: number;
  ndaSignatures7d: number;
  omDownloads7d: number;
  /** Inquiries per 1k views — null when reach is 0. */
  conversionPer1k: number | null;

  /** Number of named hot buyers from the CREXi extension scrape. */
  hotBuyerCount: number;

  latestSyncAt: string | null;
}

export interface HotBuyerRow {
  /** Composite ID so the same buyer across two listings stays distinct. */
  rowKey: string;
  name: string;
  level: string | null;
  source: "crexi" | "internal";
  propertyId: string;
  propertyName: string;
  propertySlug: string | null;
  lastActivity: string | null;
  visits: number | null;
}

export interface ListingsAnomaly {
  id: string;
  propertyId: string;
  propertySlug: string | null;
  propertyName: string;
  /** Severity drives the badge color. */
  tone: "coral" | "teal" | "amber" | "neutral";
  headline: string;
  caption: string;
}

export interface ListingsSnapshot {
  cards: ListingCard[];
  hotBuyers: HotBuyerRow[];
  anomalies: ListingsAnomaly[];
  totals: {
    sellSideCount: number;
    buySideCount: number;
    aggregateAsk: number;
    reach7d: number;
    inquiries7d: number;
  };
}

// ── Loader ────────────────────────────────────────────────────────────────
export async function loadListingsSnapshot(): Promise<ListingsSnapshot> {
  const sb = createServerSupabase();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Sell-side: properties at status in (listed, under_contract).
  const { data: sellRows } = await sb
    .from("properties")
    .select("id, name, headline, slug, address, city, state, zip, asset_type, status, transaction_type, asking_price, lease_rate, sqft, cap_rate, noi, images, crexi_url, loopnet_url, publish_to_website, created_at")
    .eq("organization_id", ORG_ID)
    .in("status", ["listed", "under_contract"])
    .order("created_at", { ascending: false });

  // Buy-side: active buyer-rep deals with a property attached.
  const { data: buyRows } = await sb
    .from("deals")
    .select(`
      id, deal_name,
      property:properties(id, name, headline, slug, address, city, state, zip, asset_type, status, transaction_type, asking_price, lease_rate, sqft, cap_rate, noi, images, crexi_url, loopnet_url, publish_to_website, created_at)
    `)
    .eq("organization_id", ORG_ID)
    .eq("deal_type", "buyer_rep")
    .eq("is_closed", false)
    .eq("is_dead", false)
    .not("property_id", "is", null);

  const sellProps = (sellRows ?? []) as any[];
  const buyDeals = (buyRows ?? []) as any[];

  const propertyIds: string[] = [
    ...sellProps.map((p) => p.id),
    ...buyDeals.map((d) => {
      const prop = Array.isArray(d.property) ? d.property[0] : d.property;
      return prop?.id;
    }).filter(Boolean),
  ];
  const uniquePropertyIds = Array.from(new Set(propertyIds));

  if (uniquePropertyIds.length === 0) {
    return {
      cards: [],
      hotBuyers: [],
      anomalies: [],
      totals: { sellSideCount: 0, buySideCount: 0, aggregateAsk: 0, reach7d: 0, inquiries7d: 0 },
    };
  }

  // Pull related metrics in parallel.
  const [metricsRes, vaultRes, ndaRes, hotBuyersRes] = await Promise.all([
    sb.from("listing_metrics")
      .select("property_id, source, period_start, period_end, views, page_views, inquiries, downloads, opened_oms, executed_cas, scraped_at")
      .eq("organization_id", ORG_ID)
      .in("property_id", uniquePropertyIds)
      .gte("period_end", sevenDaysAgo),
    sb.from("vault_access_logs")
      .select("property_id, access_type, accessed_at")
      .eq("organization_id", ORG_ID)
      .in("property_id", uniquePropertyIds)
      .in("access_type", ["download", "flyer_download"])
      .gte("accessed_at", sevenDaysAgo),
    sb.from("nda_signatures")
      .select("property_id, signed_at")
      .eq("organization_id", ORG_ID)
      .in("property_id", uniquePropertyIds)
      .is("revoked_at", null)
      .gte("signed_at", sevenDaysAgo),
    sb.from("crexi_leads_state")
      .select("id, property_id, name, level_of_interest, last_activity_date, number_of_visits")
      .eq("organization_id", ORG_ID)
      .in("property_id", uniquePropertyIds)
      .in("level_of_interest", ["Hot", "Warm"]),
  ]);

  // Aggregate per property.
  const metricsByProp = new Map<string, any[]>();
  for (const m of (metricsRes.data ?? []) as any[]) {
    const list = metricsByProp.get(m.property_id) ?? [];
    list.push(m);
    metricsByProp.set(m.property_id, list);
  }
  const downloadsByProp = countByProperty((vaultRes.data ?? []) as any[]);
  const ndasByProp = countByProperty((ndaRes.data ?? []) as any[]);
  const hotBuyersByProp = new Map<string, any[]>();
  for (const b of (hotBuyersRes.data ?? []) as any[]) {
    const list = hotBuyersByProp.get(b.property_id) ?? [];
    list.push(b);
    hotBuyersByProp.set(b.property_id, list);
  }

  // Build sell-side cards.
  const sellCards: ListingCard[] = sellProps.map((p) =>
    buildCard(p, "sell", null, metricsByProp, downloadsByProp, ndasByProp, hotBuyersByProp)
  );

  // Build buy-side cards. The deal's id is folded into the cardId so a
  // single property tracked in two pursuits doesn't dedupe (rare, but
  // possible — a co-broker arrangement, say).
  const buyCards: ListingCard[] = buyDeals
    .map((d) => {
      const prop = Array.isArray(d.property) ? d.property[0] : d.property;
      if (!prop) return null;
      return buildCard(prop, "buy", d.id, metricsByProp, downloadsByProp, ndasByProp, hotBuyersByProp);
    })
    .filter((c): c is ListingCard => c !== null);

  const cards = [...sellCards, ...buyCards];

  // ── Cross-listing hot buyers ──
  // Build a property lookup once so we can resolve names/slugs in the row
  // builder. Buyer rows that can't be matched to one of the cards are
  // dropped (probably from properties not in our active set).
  const propertyById = new Map<string, any>();
  for (const p of sellProps) propertyById.set(p.id, p);
  for (const d of buyDeals) {
    const prop = Array.isArray(d.property) ? d.property[0] : d.property;
    if (prop?.id) propertyById.set(prop.id, prop);
  }

  const hotBuyers: HotBuyerRow[] = [];
  for (const b of (hotBuyersRes.data ?? []) as any[]) {
    const propMatch = propertyById.get(b.property_id);
    if (!propMatch) continue;
    hotBuyers.push({
      rowKey: `${b.id}-${b.property_id}`,
      name: b.name || "Unnamed buyer",
      level: b.level_of_interest,
      source: "crexi",
      propertyId: b.property_id,
      propertyName: propMatch.headline || propMatch.name,
      propertySlug: propMatch.slug ?? null,
      lastActivity: b.last_activity_date ?? null,
      visits: b.number_of_visits ?? null,
    });
  }
  // Hot before Warm, then most-recent activity first.
  hotBuyers.sort((a, b) => {
    const levelOrder = (l: string | null) => (l === "Hot" ? 0 : l === "Warm" ? 1 : 2);
    const lvl = levelOrder(a.level) - levelOrder(b.level);
    if (lvl !== 0) return lvl;
    return (b.lastActivity ?? "").localeCompare(a.lastActivity ?? "");
  });
  const hotBuyersTop = hotBuyers.slice(0, 20);

  // ── Anomalies ──
  const anomalies: ListingsAnomaly[] = [];
  for (const c of cards) {
    // High reach but zero inquiries (pricing/positioning issue)
    if (c.reach7d >= 50 && c.inquiries7d === 0 && c.side === "sell") {
      anomalies.push({
        id: `dud-${c.propertyId}`,
        propertyId: c.propertyId,
        propertySlug: c.slug,
        propertyName: c.headline || c.name,
        tone: "amber",
        headline: `${c.reach7d.toLocaleString()} views, 0 inquiries`,
        caption: "Could be pricing, photos, or positioning. Worth a refresh.",
      });
    }
    // Hot buyers but no NDAs (vault flow stuck)
    if (c.hotBuyerCount >= 2 && c.ndaSignatures7d === 0) {
      anomalies.push({
        id: `vault-stuck-${c.propertyId}`,
        propertyId: c.propertyId,
        propertySlug: c.slug,
        propertyName: c.headline || c.name,
        tone: "coral",
        headline: `${c.hotBuyerCount} hot buyers, no NDAs`,
        caption: "They're circling but not engaging the vault. Reach out directly.",
      });
    }
    // Strong converter — surface positively
    if (c.conversionPer1k !== null && c.conversionPer1k >= 8 && c.inquiries7d >= 2) {
      anomalies.push({
        id: `hot-${c.propertyId}`,
        propertyId: c.propertyId,
        propertySlug: c.slug,
        propertyName: c.headline || c.name,
        tone: "teal",
        headline: `${c.conversionPer1k} per 1k converting`,
        caption: `${c.inquiries7d} inquiries on ${c.reach7d.toLocaleString()} views. Market wants this asset.`,
      });
    }
    // Long-on-market with no traffic
    if (c.daysOnMarket !== null && c.daysOnMarket >= 60 && c.reach7d < 10) {
      anomalies.push({
        id: `stale-${c.propertyId}`,
        propertyId: c.propertyId,
        propertySlug: c.slug,
        propertyName: c.headline || c.name,
        tone: "amber",
        headline: `${c.daysOnMarket}d on market, traffic dried up`,
        caption: "Refresh push, repricing conversation, or pull and re-list.",
      });
    }
  }

  // ── Totals ──
  const sellSideCards = cards.filter((c) => c.side === "sell");
  const buySideCards = cards.filter((c) => c.side === "buy");
  const aggregateAsk = sellSideCards.reduce((s, c) => s + (c.askingPrice ?? 0), 0);
  const reach7d = cards.reduce((s, c) => s + c.reach7d, 0);
  const inquiries7d = cards.reduce((s, c) => s + c.inquiries7d, 0);

  return {
    cards,
    hotBuyers: hotBuyersTop,
    anomalies: anomalies.slice(0, 6),
    totals: {
      sellSideCount: sellSideCards.length,
      buySideCount: buySideCards.length,
      aggregateAsk,
      reach7d,
      inquiries7d,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function countByProperty(rows: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.property_id, (m.get(r.property_id) ?? 0) + 1);
  }
  return m;
}

function buildCard(
  p: any,
  side: ListingSide,
  dealId: string | null,
  metricsByProp: Map<string, any[]>,
  downloadsByProp: Map<string, number>,
  ndasByProp: Map<string, number>,
  hotBuyersByProp: Map<string, any[]>,
): ListingCard {
  const ms = metricsByProp.get(p.id) ?? [];
  const reach = ms.reduce((s, m) => s + (m.page_views ?? m.views ?? 0), 0);
  const inquiries = ms.reduce((s, m) => s + (m.inquiries ?? 0), 0);
  const omDownloads = (downloadsByProp.get(p.id) ?? 0) +
                      ms.reduce((s, m) => s + (m.opened_oms ?? m.downloads ?? 0), 0);
  const ndaSignatures = (ndasByProp.get(p.id) ?? 0) +
                        ms.reduce((s, m) => s + (m.executed_cas ?? 0), 0);
  const latestSync = ms
    .map((m) => m.scraped_at)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  const daysOnMarket = p.created_at
    ? Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86400000)
    : null;

  const heroImageUrl = Array.isArray(p.images) && p.images.length > 0 ? p.images[0]?.url ?? null : null;

  return {
    cardId: side === "buy" ? `buy-${dealId}-${p.id}` : `sell-${p.id}`,
    side,
    propertyId: p.id,
    dealId,
    name: p.name,
    headline: p.headline,
    slug: p.slug,
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    assetType: p.asset_type,
    status: p.status,
    transactionType: p.transaction_type,
    askingPrice: numOrNull(p.asking_price),
    leaseRate: numOrNull(p.lease_rate),
    sqft: p.sqft ?? null,
    capRate: numOrNull(p.cap_rate),
    noi: numOrNull(p.noi),
    heroImageUrl,
    crexiUrl: p.crexi_url ?? null,
    loopnetUrl: p.loopnet_url ?? null,
    publishedToSite: !!(p.publish_to_website && p.slug),
    daysOnMarket,
    reach7d: reach,
    inquiries7d: inquiries,
    ndaSignatures7d: ndaSignatures,
    omDownloads7d: omDownloads,
    conversionPer1k: reach > 0 ? Math.round((inquiries / reach) * 1000) : null,
    hotBuyerCount: (hotBuyersByProp.get(p.id) ?? []).length,
    latestSyncAt: latestSync,
  };
}
