/**
 * POST /api/calendar/events
 *
 * Adds the events John confirmed on /cre-os/calendar to his Google
 * Calendar. Inserts only, no invites, duplicates skipped — see
 * src/lib/calendar-write.ts. Session-authed; the write itself uses the
 * service role to read the stored Google connection.
 *
 * Body: { events: NewCalendarEvent[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addCalendarEvents, type NewCalendarEvent } from "@/lib/calendar-write";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

export async function POST(req: NextRequest) {
  const session = createServerSupabase();
  const { data: { user } } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { events?: NewCalendarEvent[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return NextResponse.json({ error: "Nothing to add." }, { status: 400 });

  const sb = createAdminClient() ?? session;
  const out = await addCalendarEvents(sb, events);
  if (out.error) return NextResponse.json(out, { status: 409 });
  return NextResponse.json(out);
}
