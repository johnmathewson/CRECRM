/**
 * GET /api/map/businesses?city=Hobart — the occupancy overlay: every known
 * operating business, with its matched parcel. Public: business presence,
 * name, type and contact details are published information.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const city = (req.nextUrl.searchParams.get("city") ?? "Hobart").slice(0, 60);
  const key = process.env.MAP_DATA_KEY;
  if (!key) return NextResponse.json({ error: "MAP_DATA_KEY is not configured" }, { status: 500 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: (u, o) => fetch(u, { ...o, cache: "no-store" }) },
  });
  const { data, error } = await sb.rpc("map_businesses_active", { p_key: key, p_city: city });
  if (error) {
    console.error("[map/businesses]", error);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
  const businesses = (data ?? []) as any[];
  return NextResponse.json({ businesses, count: businesses.length }, { headers: { "cache-control": "public, max-age=300" } });
}
