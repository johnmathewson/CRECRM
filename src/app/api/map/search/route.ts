/**
 * GET /api/map/search?q=  — address / parcel number for everyone; owner names
 * are searched and returned only for registered visitors.
 */

import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/parcel-map/session";
import { searchParcels } from "@/lib/parcel-map/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });
  const gated = !!readSession(req);
  try {
    const results = await searchParcels(q.slice(0, 80), gated, 8);
    return NextResponse.json({ results, gated });
  } catch (err: any) {
    console.error("[map/search]", err);
    return NextResponse.json({ error: "search failed" }, { status: 500 });
  }
}
