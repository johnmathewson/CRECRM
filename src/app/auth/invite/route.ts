/**
 * GET /auth/invite?t=<signed token>
 *
 * The link John sends a map viewer. Verifies our 14-day HMAC token, mints a
 * Supabase magic-link token for that email server-side, verifies it right
 * away (which writes the session cookies for THIS host — the map host), and
 * sends the viewer to choose a password. Expired or tampered links go to the
 * login page with a note.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyInvite } from "@/lib/auth-invite";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const inv = verifyInvite(req.nextUrl.searchParams.get("t"));
  if (!inv) return NextResponse.redirect(`${origin}/login?next=/map/hobart&invite=expired`);
  const admin = createAdminClient();
  if (!admin) return NextResponse.redirect(`${origin}/login?next=/map/hobart&invite=error`);

  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: inv.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return NextResponse.redirect(`${origin}/login?next=/map/hobart&invite=error`);

  const sb = createServerSupabase();
  const { error: verr } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verr) return NextResponse.redirect(`${origin}/login?next=/map/hobart&invite=error`);
  return NextResponse.redirect(`${origin}/auth/set-password`);
}
