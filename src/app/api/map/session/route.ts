/**
 * GET /api/map/session — is this browser registered on the parcel map?
 * Reads the signed cookie only; no DB round-trip.
 */

import { NextRequest, NextResponse } from "next/server";
import { readSession, MAP_SESSION_COOKIE } from "@/lib/parcel-map/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const s = readSession(req);
  return NextResponse.json(s ? { registered: true, name: s.name } : { registered: false }, {
    headers: { "cache-control": "no-store" },
  });
}

/** DELETE /api/map/session — sign this browser out of the registered tier. */
export async function DELETE() {
  const res = NextResponse.json({ registered: false });
  res.cookies.set({ name: MAP_SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}
