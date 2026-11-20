/**
 * GET /api/map/listings?city=Hobart — everything currently on market, for the
 * map overlay. Public: that a property is listed, and at what price, is
 * marketed information.
 */

import { NextRequest, NextResponse } from "next/server";
import { activeListings } from "@/lib/parcel-map/listings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const city = (req.nextUrl.searchParams.get("city") ?? "Hobart").slice(0, 60);
  try {
    const listings = await activeListings(city);
    return NextResponse.json({ listings, count: listings.length }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (err: any) {
    console.error("[map/listings]", err);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
