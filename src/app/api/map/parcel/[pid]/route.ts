/**
 * GET /api/map/parcel/[pid] — one parcel. Public tier for everyone; owner /
 * value / sales / permits only when the registration cookie is present.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveViewer } from "@/lib/parcel-map/session";
import { getParcel, businessesForParcel } from "@/lib/parcel-map/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { pid: string } }) {
  const pid = decodeURIComponent(params.pid ?? "").trim();
  if (!/^[\d.\-]{10,40}$/.test(pid)) return NextResponse.json({ error: "bad pid" }, { status: 400 });
  const gated = (await resolveViewer(req)).registered;
  try {
    const [row, businesses] = await Promise.all([getParcel(pid, gated), businessesForParcel(pid).catch(() => [])]);
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ parcel: row, businesses, gated }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (err: any) {
    console.error("[map/parcel]", err);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
