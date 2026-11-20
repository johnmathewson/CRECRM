/**
 * POST /api/map/listings/sync — daily (Netlify schedule) or on demand.
 * Mirrors our own CRM listings (properties in listed / for_lease /
 * under_contract, Hobart) into map_listings and retires the ones that left
 * those statuses. Auth: x-cron-secret or a logged-in CRM session.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { ORG_ID } from "@/lib/cre-os/record-touch";
import { upsertListings, listingFromProperty, rematchUnmatched } from "@/lib/parcel-map/listings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIVE = ["listed", "for_lease", "under_contract"];

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") === secret) return true;
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} },
  });
  const { data } = await sb.auth.getUser();
  return !!data.user;
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: props, error } = await sb
    .from("properties")
    .select("id, name, address, city, status, transaction_type, asking_price, lease_rate, sqft, acreage, asset_type, apn, latitude, longitude, crexi_url, loopnet_url, slug, images")
    .eq("organization_id", ORG_ID)
    .ilike("city", "hobart")
    .in("status", ACTIVE);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const result = await upsertListings((props ?? []).map((p: any) => listingFromProperty(p)));
    // Anything of ours no longer in an active status → off market.
    const { data: stale } = await sb.rpc("map_listings_active", { p_key: process.env.MAP_DATA_KEY, p_city: "Hobart" });
    const activeIds = new Set((props ?? []).map((p: any) => p.id));
    let retired = 0;
    for (const l of (stale ?? []) as any[]) {
      if (l.source === "crm" && l.external_id && !activeIds.has(l.external_id)) {
        await sb.rpc("map_listing_checked", { p_key: process.env.MAP_DATA_KEY, p_id: l.id, p_status: "off_market", p_check: "crm_status" });
        retired++;
      }
    }
    // Captured third-party listings that still lack a parcel: try again (new
    // matcher rules, geocode fallback).
    const rematched = await rematchUnmatched("Hobart").catch(() => 0);
    return NextResponse.json({ ok: true, properties: props?.length ?? 0, ...result, retired, rematched });
  } catch (err: any) {
    console.error("[map/listings/sync]", err);
    return NextResponse.json({ error: err.message ?? "failed" }, { status: 500 });
  }
}
