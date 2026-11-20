/**
 * GET /api/map/owner?name=  — every parcel held by one deeded owner.
 * Registered visitors only (owner identity is gated).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveViewer } from "@/lib/parcel-map/session";
import { parcelsByOwner } from "@/lib/parcel-map/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await resolveViewer(req)).registered) return NextResponse.json({ error: "Please register first." }, { status: 401 });
  const name = (req.nextUrl.searchParams.get("name") ?? "").trim();
  if (!name) return NextResponse.json({ parcels: [] });
  try {
    const parcels = await parcelsByOwner(name.slice(0, 200));
    return NextResponse.json({ parcels });
  } catch (err: any) {
    console.error("[map/owner]", err);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
