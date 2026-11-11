/**
 * POST /api/agents/deal-checkin/run
 *
 * Builds tonight's deal check-in now instead of waiting for 8:45 PM —
 * the "Build it now" button on /cre-os/checkin. Kicks the background
 * function and returns 202; the page refreshes until the row appears.
 * Manual runs don't text John (he's already looking at the page).
 *
 * Auth: John's session. The background function itself checks
 * CRON_SECRET, which this route forwards.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const { data: { user } } = await createServerSupabase().auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const baseUrl = process.env.URL || req.nextUrl.origin;
  try {
    const res = await fetch(`${baseUrl}/.netlify/functions/deal-checkin-run-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
      body: JSON.stringify({ force: true, skipNotify: true }),
    });
    if (res.status !== 202 && !res.ok) {
      return NextResponse.json({ error: `Background function returned ${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, status: "queued" }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
