/**
 * GET /api/integrations/google/status
 *
 * UI-facing endpoint. Returns whether Gmail is connected, which mailbox,
 * last poll timestamp, and any recent poll error.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Step 1: get all rows for the org (no other filters) — surfaces RLS / policy issues
  const allForOrg = await supabase
    .from("gmail_oauth_tokens")
    .select("id, email, granted_at, revoked_at, organization_id")
    .eq("organization_id", ORG_ID);

  // Step 2: the production query
  const filtered = await supabase
    .from("gmail_oauth_tokens")
    .select("email, scopes, granted_at, last_polled_at, poll_error, last_history_id, revoked_at")
    .eq("organization_id", ORG_ID)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const debug = {
    org_id: ORG_ID,
    all_for_org_count: allForOrg.data?.length ?? null,
    all_for_org_error: allForOrg.error?.message ?? null,
    all_for_org_sample: allForOrg.data?.slice(0, 3) ?? null,
    filtered_data: filtered.data ?? null,
    filtered_error: filtered.error?.message ?? null,
    supabase_url_set: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon_key_set: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  if (filtered.error) {
    return NextResponse.json({ error: filtered.error.message, debug }, { status: 500 });
  }
  if (!filtered.data) {
    return NextResponse.json({ connected: false, debug });
  }

  return NextResponse.json({
    connected: true,
    email: filtered.data.email,
    scopes: filtered.data.scopes,
    granted_at: filtered.data.granted_at,
    last_polled_at: filtered.data.last_polled_at,
    last_history_id: filtered.data.last_history_id,
    poll_error: filtered.data.poll_error,
    debug,
  });
}
