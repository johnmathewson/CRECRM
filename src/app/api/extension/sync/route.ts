/**
 * POST /api/extension/sync
 *
 * The Chrome extension hits this with scraped metrics from CREXi/LoopNet.
 *
 * Auth: API key in `x-extension-key` header. Hashed and looked up in
 * extension_api_keys. Soft-revocable.
 *
 * Body:
 *   {
 *     source: "crexi" | "loopnet",
 *     external_listing_id: "12345",      // CREXi/LoopNet listing ID from URL
 *     external_url?: string,
 *     metrics: { views, saves, inquiries, downloads },
 *     period_start?: string (ISO date) — defaults to current Monday,
 *     scraped_at?: string (ISO timestamp) — defaults to now,
 *     raw?: object — full payload for forensics
 *   }
 *
 * Behavior:
 *   - Looks up the property by source + external_listing_id (matching
 *     properties.crexi_listing_id or properties.loopnet_listing_id, falling
 *     back to a substring match on crexi_url / loopnet_url if needed).
 *   - Upserts a row in listing_metrics (unique on property+source+period).
 *   - Marks any pending metric_sync_requests for that property+source as
 *     fulfilled.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID, hashSecret, isoDate, startOfWeek, endOfWeek } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = ["chrome-extension://*"]; // Chrome extensions send their origin

function corsHeaders(origin: string | null): Record<string, string> {
  // Extensions don't always send Origin; allow * for these endpoints since
  // auth is the API key, not origin.
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-extension-key",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

interface SyncBody {
  source: "crexi" | "loopnet";
  external_listing_id: string;
  external_url?: string;
  metrics: {
    // Legacy generic fields (LoopNet + older extension builds)
    views?: number;
    saves?: number;
    inquiries?: number;       // Leads
    downloads?: number;       // Opened OMs (legacy alias for opened_oms)
    nda_executions?: number;  // Executed CAs (legacy alias for executed_cas)
    offers?: number;          // Offers received
    // CREXi-native funnel fields (May 2026 dashboard surfaces these distinctly)
    impressions?: number;
    page_views?: number;
    unique_visitors?: number;
    opened_oms?: number;
    executed_cas?: number;
  };
  period_start?: string;
  scraped_at?: string;
  raw?: any;
}

async function authenticateKey(supabase: any, key: string | null): Promise<{ ok: boolean; keyRowId?: string; error?: string }> {
  if (!key) return { ok: false, error: "Missing x-extension-key header" };
  const keyHash = hashSecret(key);
  const { data } = await supabase
    .from("extension_api_keys")
    .select("id, revoked_at")
    .eq("key_hash", keyHash)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!data) return { ok: false, error: "Invalid key" };
  if (data.revoked_at) return { ok: false, error: "Key revoked" };
  // Bump last_used_at fire-and-forget
  supabase.from("extension_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => null);
  return { ok: true, keyRowId: data.id };
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Auth ──
  const auth = await authenticateKey(supabase, req.headers.get("x-extension-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401, headers: corsHeaders(origin) });
  }

  // ── Body ──
  let body: SyncBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(origin) });
  }
  if (!body.source || !body.external_listing_id) {
    return NextResponse.json({ error: "source + external_listing_id required" }, { status: 400, headers: corsHeaders(origin) });
  }

  // ── Find property by external listing id ──
  const idColumn = body.source === "crexi" ? "crexi_listing_id" : "loopnet_listing_id";
  const urlColumn = body.source === "crexi" ? "crexi_url" : "loopnet_url";

  const { data: byId } = await supabase
    .from("properties")
    .select("id, name, " + idColumn + ", " + urlColumn)
    .eq("organization_id", ORG_ID)
    .eq(idColumn, body.external_listing_id)
    .maybeSingle();

  let property: any = byId;

  if (!property && body.external_url) {
    // Fall back: find by URL substring (extracts listing ID portion)
    const { data: byUrl } = await supabase
      .from("properties")
      .select("id, name, " + idColumn + ", " + urlColumn)
      .eq("organization_id", ORG_ID)
      .ilike(urlColumn, `%${body.external_listing_id}%`)
      .maybeSingle();
    if (byUrl) {
      property = byUrl;
      // Backfill the listing_id column for future lookups
      await supabase.from("properties").update({ [idColumn]: body.external_listing_id }).eq("id", property.id);
    }
  }

  if (!property) {
    const fieldLabel = body.source === "crexi" ? "CREXi URL" : "LoopNet URL";
    const urlToPaste = body.external_url || `(this listing's URL, ID ${body.external_listing_id})`;
    return NextResponse.json(
      {
        error: "No property in CRM matches this listing.",
        hint: `Open the matching property in the CRM, paste this into the "${fieldLabel}" field, and save: ${urlToPaste}`,
      },
      { status: 404, headers: corsHeaders(origin) }
    );
  }

  // ── Upsert metrics row ──
  const periodStart = body.period_start ? new Date(body.period_start) : startOfWeek();
  const periodEnd = endOfWeek(periodStart);
  const m = body.metrics || {};
  const scrapedAt = body.scraped_at || new Date().toISOString();

  // Accept the new CREXi-native fields (impressions / page_views /
  // unique_visitors / opened_oms / executed_cas) and the legacy generic ones
  // (views / saves / inquiries / downloads / nda_executions / offers) for
  // backward compatibility with older extension versions and LoopNet.
  // For CREXi specifically: the legacy `views` field is left null when the
  // new specific fields are populated, so the dashboard can prefer the new
  // ones and fall back if absent.
  const upsertPayload: Record<string, unknown> = {
    organization_id: ORG_ID,
    property_id: property.id,
    source: body.source,
    period_start: isoDate(periodStart),
    period_end: isoDate(periodEnd),
    // Legacy generic fields (kept for LoopNet + older extension builds)
    views: m.views ?? null,
    saves: m.saves ?? null,
    inquiries: m.inquiries ?? null,
    downloads: m.downloads ?? null,
    nda_executions: m.nda_executions ?? null,
    offers: m.offers ?? 0,
    // New CREXi-native fields (preferred when present)
    impressions: m.impressions ?? null,
    page_views: m.page_views ?? null,
    unique_visitors: m.unique_visitors ?? null,
    opened_oms: m.opened_oms ?? null,
    executed_cas: m.executed_cas ?? null,
    raw_payload: body.raw || null,
    scraped_at: scrapedAt,
  };

  const { error: upsertErr } = await supabase
    .from("listing_metrics")
    .upsert(upsertPayload, { onConflict: "property_id,source,period_start" });

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500, headers: corsHeaders(origin) });
  }

  // ── Fulfill any matching pending sync requests ──
  await supabase
    .from("metric_sync_requests")
    .update({ fulfilled_at: new Date().toISOString() })
    .eq("property_id", property.id)
    .in("source", [body.source, "any"])
    .is("fulfilled_at", null)
    .is("failed_at", null);

  return NextResponse.json(
    {
      ok: true,
      property: { id: property.id, name: property.name },
      period_start: isoDate(periodStart),
      metrics: upsertPayload,
    },
    { status: 200, headers: corsHeaders(origin) }
  );
}
