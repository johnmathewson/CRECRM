/**
 * POST /api/extension/listings
 *
 * The Chrome extension's daily capture of CREXi / LoopNet search results
 * for Hobart (run in John's own logged-in browser by a background alarm).
 * Auth: x-extension-key (same keys as /api/extension/sync).
 *
 * Body: { source: "crexi"|"loopnet", kind: "sale"|"lease", city?: string,
 *         search_url: string, complete: boolean,
 *         listings: [{ external_id, url, title, address, price_text, sqft, acres, asset_type, broker_company, raw }] }
 *
 * `complete: true` means the page listed every active result for that
 * (source, kind) search, so anything of that source not seen in 3 days is
 * marked off market.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { hashSecret } from "@/lib/owner-dashboard";
import { upsertListings, expireUnseen, parsePrice, type ListingIn } from "@/lib/parcel-map/listings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-extension-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const apiKey = req.headers.get("x-extension-key");
  if (!apiKey) return NextResponse.json({ error: "Missing x-extension-key" }, { status: 401, headers: CORS });
  const { data: keyRow } = await sb.from("extension_api_keys").select("id, revoked_at").eq("key_hash", hashSecret(apiKey)).maybeSingle();
  if (!keyRow || keyRow.revoked_at) return NextResponse.json({ error: "Invalid key" }, { status: 401, headers: CORS });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS }); }
  const source = body.source === "loopnet" ? "loopnet" : body.source === "crexi" ? "crexi" : null;
  const kind = body.kind === "lease" ? "lease" : "sale";
  if (!source || !Array.isArray(body.listings)) return NextResponse.json({ error: "source and listings[] required" }, { status: 400, headers: CORS });
  const city = typeof body.city === "string" && body.city.trim() ? body.city.trim() : "Hobart";
  const seenAt = new Date().toISOString();

  const rows: ListingIn[] = body.listings
    .filter((l: any) => l && (l.external_id || l.url))
    .slice(0, 300)
    .map((l: any) => ({
      source, kind, city, status: "active" as const,
      external_id: l.external_id ? String(l.external_id) : null,
      url: typeof l.url === "string" ? l.url.slice(0, 500) : null,
      title: str(l.title), address: str(l.address),
      price_text: str(l.price_text), price: parsePrice(l.price_text),
      lease_rate_text: kind === "lease" ? str(l.price_text) : null,
      sqft: num(l.sqft), acres: num(l.acres), asset_type: str(l.asset_type), broker_company: str(l.broker_company),
      photo_url: typeof l.photo_url === "string" && /^https:\/\//.test(l.photo_url) ? l.photo_url.slice(0, 600) : null,
      seen_at: seenAt, raw: { search_url: str(body.search_url), captured: l },
    }));

  try {
    const result = await upsertListings(rows);
    const expired = body.complete === true ? await expireUnseen(source, city, 3) : 0;
    await sb.from("extension_api_keys").update({ last_used_at: seenAt }).eq("id", keyRow.id);
    return NextResponse.json({ ok: true, ...result, expired }, { headers: CORS });
  } catch (err: any) {
    console.error("[extension/listings]", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500, headers: CORS });
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(/[^\d.]/g, "")) : NaN; return Number.isFinite(n) ? n : null; };
