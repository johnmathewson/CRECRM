/**
 * GET /api/integrations/google/accounts
 *
 * Every connected Google account with what it's used for and whether
 * Calendar was granted, plus calendar-sync stats. Feeds Settings →
 * "Calendar & personal email". Session-authed.
 */

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { PRIMARY_MAILBOX } from "@/lib/gmail-auth";
import { CALENDAR_SCOPE } from "@/lib/google-oauth";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET() {
  const sb = createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [{ data: rows, error }, { count: events }, { data: last }] = await Promise.all([
    sb
      .from("gmail_oauth_tokens")
      .select("email, scopes, granted_at, poll_error")
      .eq("organization_id", ORG_ID)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false }),
    sb.from("calendar_events").select("id", { count: "exact", head: true }).eq("organization_id", ORG_ID),
    sb.from("calendar_events").select("synced_at").eq("organization_id", ORG_ID).order("synced_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    accounts: (rows ?? []).map((r: any) => ({
      email: r.email,
      primary: String(r.email).toLowerCase() === PRIMARY_MAILBOX,
      calendar: ((r.scopes ?? []) as string[]).includes(CALENDAR_SCOPE),
      grantedAt: r.granted_at,
      // netlify/functions/poll-gmail writes "function-heartbeat:<ts>" into
      // poll_error as a liveness marker — that's not an error.
      error: r.poll_error && !String(r.poll_error).startsWith("function-heartbeat:") ? r.poll_error : null,
    })),
    calendar: { events: events ?? 0, lastSyncedAt: last?.synced_at ?? null },
  });
}
