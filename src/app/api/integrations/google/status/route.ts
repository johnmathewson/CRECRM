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

  const { data, error } = await supabase
    .from("gmail_oauth_tokens")
    .select("email, scopes, granted_at, last_polled_at, poll_error, last_history_id, revoked_at")
    .eq("organization_id", ORG_ID)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ connected: false });

  return NextResponse.json({
    connected: true,
    email: data.email,
    scopes: data.scopes,
    granted_at: data.granted_at,
    last_polled_at: data.last_polled_at,
    last_history_id: data.last_history_id,
    poll_error: data.poll_error,
  });
}
