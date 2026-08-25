/**
 * POST /api/integrations/google/disconnect
 *
 * Revokes the OAuth grant at Google + soft-deletes our token row. Future
 * polling cycles skip revoked rows.
 */

import { NextResponse } from "next/server";
import { refreshAccessToken, revokeToken } from "@/lib/google-oauth";
import { createServiceSupabase } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/auth/require-staff";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST() {
  // Staff-only: middleware does not cover /api (see require-staff.ts).
  const denied = await requireStaff();
  if (denied) return denied;

  const supabase = createServiceSupabase();

  const { data: token } = await supabase
    .from("gmail_oauth_tokens")
    .select("id, refresh_token")
    .eq("organization_id", ORG_ID)
    .is("revoked_at", null)
    .maybeSingle();

  if (!token) {
    return NextResponse.json({ ok: true, message: "No active connection" });
  }

  // Get a fresh access token to revoke (or revoke the refresh token directly).
  // Google's revoke endpoint accepts either; the refresh token is more reliable
  // since access tokens expire fast.
  await revokeToken(token.refresh_token);

  await supabase
    .from("gmail_oauth_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", token.id);

  return NextResponse.json({ ok: true });
}
