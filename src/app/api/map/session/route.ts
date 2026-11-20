/**
 * GET /api/map/session — is this browser registered on the parcel map?
 * Reads the signed cookie only; no DB round-trip.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveViewer, MAP_SESSION_COOKIE } from "@/lib/parcel-map/session";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const v = await resolveViewer(req);
  return NextResponse.json({ registered: v.registered, admin: v.admin, login: v.login, name: v.name }, {
    headers: { "cache-control": "no-store" },
  });
}

/** DELETE /api/map/session — sign this browser out of the registered tier
 *  (and out of a Supabase login, so partner accounts can sign out too). */
export async function DELETE() {
  try { await createServerSupabase().auth.signOut(); } catch { /* no login */ }
  const res = NextResponse.json({ registered: false });
  res.cookies.set({ name: MAP_SESSION_COOKIE, value: "", path: "/", maxAge: 0 });
  return res;
}
