/**
 * POST /api/integrations/google/disconnect
 *
 * Revokes the OAuth grant at Google + soft-deletes our token row. Future
 * polling cycles skip revoked rows.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { refreshAccessToken, revokeToken } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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
