/**
 * GET /api/public/owner/[token]
 *
 * The marketing site's /owner/[token] dashboard fetches this. Returns:
 *   - The properties scoped to this token (full public-facing facts).
 *   - Per-listing weekly metrics from listing_metrics + own-site page_views.
 *   - Per-listing engagement counters: inquiries, NDAs, OM downloads.
 *   - Anonymized recent inquiry summaries (no names, no contact info).
 *   - Saved seller-net offer scenarios (published only) + their attachments.
 *
 * Bumps last_viewed_at + writes a "any" sync request so John's browser
 * extension picks up the latest CREXi/LoopNet numbers next time it polls.
 *
 * ────────────────────────────────────────────────────────────────────────
 * SECURITY MODEL — share-by-link, NOT a true magic link
 * ────────────────────────────────────────────────────────────────────────
 * The token in the URL is the only credential. There is no email
 * verification, no session establishment, no cookie. Anyone with the URL
 * can open the dashboard for the lifetime of the token.
 *
 * The token is opaque (24 random bytes hex = 48 chars), so it's not
 * guessable, but if a recipient forwards the link (intentionally or via
 * cached email/browser history), the recipient gets full access to:
 *   • Listing performance (low sensitivity — owner already has this data)
 *   • Saved seller-net scenarios — including partner waterfalls (HIGHER
 *     sensitivity; partner names, capital amounts, distribution math)
 *
 * DEFERRED — true magic link upgrade. When the seller-net offer feature
 * sees real-world use, upgrade to one of:
 *   Level 2 — One-time email gate: first visit prompts for email,
 *             must match owner_contact_id.email, sets a cookie.
 *             No email-send infra needed.
 *   Level 3 — Email-delivered link: token sent via Gmail OAuth, exchanged
 *             on click for a session JWT. True OAuth-style flow.
 * Decision recorded 2026-05-08; user prefers to defer until partner-
 * waterfall data is being shared more broadly.
 * ────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID, anonymizeLead, isoDate, startOfWeek, endOfWeek } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://stewardshipcre.com",
  "https://www.stewardshipcre.com",
  "http://localhost:3000",
  "http://localhost:3001",
];
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

const WEEKS_TO_RETURN = 8;

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const origin = req.headers.get("origin");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Validate token ──
  const { data: tokenRow } = await supabase
    .from("owner_access_tokens")
    .select("id, property_ids, label, audience, expires_at, revoked_at, last_viewed_at, owner_contact_id")
    .eq("token", params.token)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!tokenRow || tokenRow.revoked_at) {
    return NextResponse.json({ error: "Invalid or revoked link" }, { status: 401, headers: corsHeaders(origin) });
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Link expired" }, { status: 401, headers: corsHeaders(origin) });
  }

  const propertyIds: string[] = tokenRow.property_ids || [];
  if (propertyIds.length === 0) {
    return NextResponse.json({ error: "No listings linked to this token" }, { status: 404, headers: corsHeaders(origin) });
  }

  // ── Compute week window: last N weeks ending this week ──
  const thisWeekStart = startOfWeek();
  const earliestStart = new Date(thisWeekStart);
  earliestStart.setUTCDate(earliestStart.getUTCDate() - 7 * (WEEKS_TO_RETURN - 1));

  // ── Pull everything in parallel ──
  const [propsRes, metricsRes, viewsRes, inquiriesRes, ndaRes, downloadsRes, offersRes] = await Promise.all([
    supabase
      .from("properties")
      .select("id, name, headline, address, city, state, asset_type, transaction_type, status, asking_price, lease_rate, sqft, slug, images, crexi_url, loopnet_url")
      .eq("organization_id", ORG_ID)
      .in("id", propertyIds),
    supabase
      .from("listing_metrics")
      .select("property_id, source, period_start, period_end, views, saves, inquiries, downloads, nda_executions, offers, impressions, page_views, unique_visitors, opened_oms, executed_cas, scraped_at")
      .eq("organization_id", ORG_ID)
      .in("property_id", propertyIds)
      .gte("period_start", isoDate(earliestStart))
      .order("period_start", { ascending: true }),
    supabase
      .from("page_views")
      .select("property_id, viewed_at")
      .eq("organization_id", ORG_ID)
      .in("property_id", propertyIds)
      .gte("viewed_at", earliestStart.toISOString()),
    supabase
      .from("leads")
      .select("id, property_id, intent, urgency, qualifier_summary, created_at, status")
      .eq("organization_id", ORG_ID)
      .in("property_id", propertyIds)
      .gte("created_at", earliestStart.toISOString())
      .not("status", "in", '("spam","archived")')
      .order("created_at", { ascending: false }),
    supabase
      .from("nda_signatures")
      .select("property_id, signed_at, nda_version_id, nda_version:nda_versions(lead_type)")
      .eq("organization_id", ORG_ID)
      .in("property_id", propertyIds)
      .gte("signed_at", earliestStart.toISOString())
      .is("revoked_at", null),
    supabase
      .from("vault_access_logs")
      .select("property_id, access_type, accessed_at")
      .eq("organization_id", ORG_ID)
      .in("property_id", propertyIds)
      .gte("accessed_at", earliestStart.toISOString()),
    supabase
      .from("seller_net_offers")
      .select("id, property_id, title, buyer_name, offer_date, offer_price, commission_pct, commission_amount, line_items, partners, computed_commission, computed_adjustments, computed_net_proceeds, computed_partners_due, computed_net_after_partners, notes, published_at, created_at, updated_at")
      .eq("organization_id", ORG_ID)
      .in("property_id", propertyIds)
      .not("published_at", "is", null)  // owner sees published only
      .order("published_at", { ascending: false }),
  ]);

  // ── Aggregate + anonymize ──
  type WeeklyBucket = {
    week_start: string;
    // CREXi-specific funnel (matches the labels on the CREXi seller dashboard)
    crexi_impressions: number;     // CREXi "Impressions" — search-result eyeballs
    crexi_page_views: number;      // CREXi "Page Views"  — clicked into the listing
    crexi_unique_visitors: number; // CREXi "Visitors"    — deduped audience
    crexi_opened_oms: number;      // CREXi "Opened OMs"  — engaged
    crexi_executed_cas: number;    // CREXi "Executed CAs" — signed NDA
    crexi_offers: number;          // CREXi "Offers"
    crexi_leads: number;           // CREXi "Leads" (some surfaces only)
    // LoopNet (still single-view metric)
    loopnet_views: number;
    // Own-site signals (anonymized aggregates only)
    site_views: number;
    inquiries: number;
    nda_signatures: number;
    om_downloads: number;
    // Legacy generic CREXi views — populated as page_views for backwards
    // compatibility with any older client code reading the old shape.
    crexi_views: number;
  };

  const propsById = new Map<string, any>();
  for (const p of (propsRes.data || []) as any[]) {
    propsById.set(p.id, { ...p, weeks: new Map<string, WeeklyBucket>() });
  }

  function getBucket(p: any, weekStart: string): WeeklyBucket {
    let b = p.weeks.get(weekStart);
    if (!b) {
      b = {
        week_start: weekStart,
        crexi_impressions: 0, crexi_page_views: 0, crexi_unique_visitors: 0,
        crexi_opened_oms: 0, crexi_executed_cas: 0, crexi_offers: 0,
        crexi_leads: 0, crexi_views: 0,
        loopnet_views: 0, site_views: 0,
        inquiries: 0, nda_signatures: 0, om_downloads: 0,
      };
      p.weeks.set(weekStart, b);
    }
    return b;
  }

  // Listing metrics → per-source signals per week.
  // CREXi: prefer the new specific columns when populated (extension v2+),
  // fall back to legacy fields for older scrapes.
  for (const m of (metricsRes.data || []) as any[]) {
    const p = propsById.get(m.property_id);
    if (!p) continue;
    const b = getBucket(p, m.period_start);
    if (m.source === "crexi") {
      b.crexi_impressions     = m.impressions     ?? 0;
      b.crexi_page_views      = m.page_views      ?? 0;
      b.crexi_unique_visitors = m.unique_visitors ?? 0;
      b.crexi_opened_oms      = m.opened_oms      ?? m.downloads ?? 0;
      b.crexi_executed_cas    = m.executed_cas    ?? m.nda_executions ?? 0;
      b.crexi_offers          = m.offers          ?? 0;
      b.crexi_leads           = m.inquiries       ?? 0;
      // Legacy generic — page_views is the most useful single number, fall
      // back to unique_visitors then impressions then the legacy `views`.
      b.crexi_views = b.crexi_page_views || b.crexi_unique_visitors || b.crexi_impressions || (m.views ?? 0);
    } else if (m.source === "loopnet") {
      b.loopnet_views = m.views ?? 0;
    }
  }

  // Page views → site_views per week
  for (const v of (viewsRes.data || []) as any[]) {
    const p = propsById.get(v.property_id);
    if (!p) continue;
    const wkStart = isoDate(startOfWeek(new Date(v.viewed_at)));
    getBucket(p, wkStart).site_views += 1;
  }

  // Inquiries
  const recentInquiriesByProperty = new Map<string, string[]>();
  for (const lead of (inquiriesRes.data || []) as any[]) {
    const p = propsById.get(lead.property_id);
    if (!p) continue;
    const wkStart = isoDate(startOfWeek(new Date(lead.created_at)));
    getBucket(p, wkStart).inquiries += 1;
    const list = recentInquiriesByProperty.get(lead.property_id) || [];
    if (list.length < 5) list.push(anonymizeLead(lead));
    recentInquiriesByProperty.set(lead.property_id, list);
  }

  // NDAs
  for (const sig of (ndaRes.data || []) as any[]) {
    const p = propsById.get(sig.property_id);
    if (!p) continue;
    getBucket(p, isoDate(startOfWeek(new Date(sig.signed_at)))).nda_signatures += 1;
  }

  // OM / vault downloads
  for (const dl of (downloadsRes.data || []) as any[]) {
    if (dl.access_type !== "download" && dl.access_type !== "flyer_download") continue;
    const p = propsById.get(dl.property_id);
    if (!p) continue;
    getBucket(p, isoDate(startOfWeek(new Date(dl.accessed_at)))).om_downloads += 1;
  }

  // ── Build response per property ──
  const propertiesOut = Array.from(propsById.values()).map((p: any) => {
    const bucketArr: WeeklyBucket[] = (Array.from(p.weeks.values()) as WeeklyBucket[]).sort((a, b) =>
      a.week_start.localeCompare(b.week_start)
    );
    // Pad missing weeks
    const padded: WeeklyBucket[] = [];
    let cursor = new Date(earliestStart);
    while (cursor <= thisWeekStart) {
      const wkStr = isoDate(cursor);
      const found = bucketArr.find(b => b.week_start === wkStr);
      padded.push(found || {
        week_start: wkStr,
        crexi_impressions: 0, crexi_page_views: 0, crexi_unique_visitors: 0,
        crexi_opened_oms: 0, crexi_executed_cas: 0, crexi_offers: 0,
        crexi_leads: 0, crexi_views: 0,
        loopnet_views: 0, site_views: 0,
        inquiries: 0, nda_signatures: 0, om_downloads: 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    const thisWeek = padded[padded.length - 1] || {
      week_start: isoDate(thisWeekStart),
      crexi_impressions: 0, crexi_page_views: 0, crexi_unique_visitors: 0,
      crexi_opened_oms: 0, crexi_executed_cas: 0, crexi_offers: 0,
      crexi_leads: 0, crexi_views: 0,
      loopnet_views: 0, site_views: 0,
      inquiries: 0, nda_signatures: 0, om_downloads: 0,
    };
    const lastWeek = padded[padded.length - 2];

    function delta(now: number, prev: number | undefined): number | null {
      if (prev === undefined || prev === 0) return null;
      return Math.round(((now - prev) / prev) * 100);
    }

    return {
      id: p.id,
      name: p.name,
      headline: p.headline,
      slug: p.slug,
      address: p.address,
      city: p.city,
      state: p.state,
      asset_type: p.asset_type,
      transaction_type: p.transaction_type,
      status: p.status,
      asking_price: p.asking_price,
      lease_rate: p.lease_rate,
      sqft: p.sqft,
      hero_image_url:
        Array.isArray(p.images) && p.images.length > 0 ? p.images[0]?.url : null,
      crexi_url: p.crexi_url,
      loopnet_url: p.loopnet_url,
      this_week: thisWeek,
      deltas: lastWeek
        ? {
            crexi_impressions: delta(thisWeek.crexi_impressions, lastWeek.crexi_impressions),
            crexi_page_views: delta(thisWeek.crexi_page_views, lastWeek.crexi_page_views),
            crexi_unique_visitors: delta(thisWeek.crexi_unique_visitors, lastWeek.crexi_unique_visitors),
            crexi_views: delta(thisWeek.crexi_views, lastWeek.crexi_views),
            loopnet_views: delta(thisWeek.loopnet_views, lastWeek.loopnet_views),
            site_views: delta(thisWeek.site_views, lastWeek.site_views),
            inquiries: delta(thisWeek.inquiries, lastWeek.inquiries),
            om_downloads: delta(thisWeek.om_downloads, lastWeek.om_downloads),
            crexi_leads: delta(thisWeek.crexi_leads, lastWeek.crexi_leads),
            crexi_opened_oms: delta(thisWeek.crexi_opened_oms, lastWeek.crexi_opened_oms),
            crexi_executed_cas: delta(thisWeek.crexi_executed_cas, lastWeek.crexi_executed_cas),
            crexi_offers: delta(thisWeek.crexi_offers, lastWeek.crexi_offers),
          }
        : null,
      trend: padded,
      recent_inquiries: recentInquiriesByProperty.get(p.id) || [],
      latest_metric_scrape:
        (metricsRes.data || [])
          .filter((m: any) => m.property_id === p.id)
          .sort((a: any, b: any) => (b.scraped_at || "").localeCompare(a.scraped_at || ""))[0]?.scraped_at || null,
    };
  });

  // ── Bump last_viewed_at + request a fresh sync ──
  await Promise.all([
    supabase
      .from("owner_access_tokens")
      .update({ last_viewed_at: new Date().toISOString() })
      .eq("id", tokenRow.id),
    // Only request a sync if last fulfilled was > 30 min ago, to avoid spamming.
    (async () => {
      for (const pid of propertyIds) {
        const { data: recent } = await supabase
          .from("metric_sync_requests")
          .select("requested_at")
          .eq("property_id", pid)
          .order("requested_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!recent || (Date.now() - new Date(recent.requested_at).getTime() > 30 * 60 * 1000)) {
          await supabase.from("metric_sync_requests").insert({
            organization_id: ORG_ID,
            property_id: pid,
            source: "any",
            reason: "owner_dashboard_view",
          });
        }
      }
    })(),
  ]);

  // ── Hydrate attachments for the published offers ──
  // Owner portal only sees published offers, so we only need attachments
  // tied to those offer ids. Sign URLs with a 30-min TTL.
  const offerIds = (offersRes.data ?? []).map((o: any) => o.id);
  let attachmentsByOffer: Record<string, any[]> = {};
  if (offerIds.length > 0) {
    const { data: attachRows } = await supabase
      .from("offer_attachments")
      .select("id, offer_id, file_name, storage_path, file_size, mime_type, doc_type, uploaded_at")
      .eq("organization_id", ORG_ID)
      .in("offer_id", offerIds)
      .order("uploaded_at", { ascending: false });

    for (const r of (attachRows ?? []) as any[]) {
      const { data: signed } = await supabase.storage
        .from("offer-attachments")
        .createSignedUrl(r.storage_path, 60 * 30);
      const enriched = { ...r, signed_url: signed?.signedUrl ?? null };
      const list = attachmentsByOffer[r.offer_id] ?? [];
      list.push(enriched);
      attachmentsByOffer[r.offer_id] = list;
    }
  }
  const offersWithAttachments = (offersRes.data ?? []).map((o: any) => ({
    ...o,
    attachments: attachmentsByOffer[o.id] ?? [],
  }));

  return NextResponse.json(
    {
      label: tokenRow.label,
      // 'owner' (default) or 'investor'. Marketing site uses this to redirect
      // to the right route if a recipient lands on the wrong one.
      audience: tokenRow.audience === "investor" ? "investor" : "owner",
      expires_at: tokenRow.expires_at,
      properties: propertiesOut,
      week_starting: isoDate(thisWeekStart),
      // Seller-net offer scenarios saved against any of these properties,
      // each with a freshly-signed URL list of attachments.
      offers: offersWithAttachments,
    },
    { headers: corsHeaders(origin) }
  );
}
