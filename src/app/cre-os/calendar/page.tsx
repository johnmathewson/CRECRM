import { AddToCalendarView } from "@/components/cre-os/calendar/AddToCalendarView";
import { createServerSupabase } from "@/lib/supabase/server";
import { calendarTokenRow } from "@/lib/calendar-sync";
import { canWriteCalendar } from "@/lib/google-oauth";

/**
 * /cre-os/calendar — add events to John's Google Calendar from pasted text,
 * a PDF or a photo. Page is behind the login middleware; the token lookup
 * runs server-side through the service role (tokenStore).
 */
export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const row = await calendarTokenRow(createServerSupabase());
  return <AddToCalendarView canWrite={canWriteCalendar(row?.scopes)} account={row?.email ?? null} />;
}
