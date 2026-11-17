/**
 * Add events to John's Google Calendar — only the ones he confirms in the
 * CRM (/cre-os/calendar). Needs the calendar.events grant on the personal
 * Google connection (Settings → Calendar & personal email).
 *
 * Deliberately narrow:
 *   • inserts only — never edits or deletes an existing event;
 *   • no attendees and sendUpdates=none — nobody is ever invited or emailed;
 *   • skips an event when one with the same title already starts at the
 *     same time that day (e.g. a schedule he already imported as .ics).
 *
 * Times are wall-clock in America/Chicago unless the caller says otherwise;
 * Google applies the zone, so DST is never computed here.
 */

import { getActiveGmailTokens } from "@/lib/gmail-auth";
import { canWriteCalendar } from "@/lib/google-oauth";
import { calendarTokenRow } from "@/lib/calendar-sync";

export const CALENDAR_TZ = "America/Chicago";

export interface NewCalendarEvent {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (24h). Omit both start and end for an all-day event. */
  start?: string | null;
  end?: string | null;
  location?: string | null;
  details?: string | null;
}

export interface AddEventResult {
  title: string;
  date: string;
  start: string | null;
  status: "added" | "duplicate" | "error";
  link?: string | null;
  error?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Minutes since midnight in CALENDAR_TZ for an RFC3339 instant. */
function localMinutes(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: CALENDAR_TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function addCalendarEvents(
  sb: any,
  events: NewCalendarEvent[]
): Promise<{ account: string | null; results: AddEventResult[]; error?: string }> {
  const row = await calendarTokenRow(sb);
  if (!row) return { account: null, results: [], error: "No personal Google account is connected." };
  if (!canWriteCalendar(row.scopes)) {
    return { account: row.email, results: [], error: "Calendar is read-only. Reconnect in Settings and allow adding events." };
  }
  const token = (await getActiveGmailTokens(sb)).find((t) => t.email.toLowerCase() === row.email.toLowerCase());
  if (!token) return { account: row.email, results: [], error: "The Google connection couldn't be refreshed. Reconnect in Settings." };
  const auth = { Authorization: `Bearer ${token.accessToken}` };
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

  // What's already on each affected day, fetched once per day (±1 day so
  // UTC edges are covered), for the duplicate check.
  const dayCache = new Map<string, Array<{ title: string; date: string; minutes: number | null }>>();
  async function existingOn(date: string) {
    if (dayCache.has(date)) return dayCache.get(date)!;
    const prev = new Date(`${date}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const params = new URLSearchParams({
      timeMin: `${prev.toISOString().slice(0, 10)}T00:00:00Z`,
      timeMax: `${nextDate(nextDate(date))}T00:00:00Z`,
      singleEvents: "true",
      maxResults: "250",
    });
    const res = await fetch(`${base}?${params}`, { headers: auth });
    const list: Array<{ title: string; date: string; minutes: number | null }> = [];
    if (res.ok) {
      const j = (await res.json()) as { items?: any[] };
      for (const e of j.items ?? []) {
        if (e.status === "cancelled") continue;
        if (e.start?.dateTime) {
          const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_TZ }).format(new Date(e.start.dateTime));
          list.push({ title: norm(e.summary ?? ""), date: localDate, minutes: localMinutes(e.start.dateTime) });
        } else if (e.start?.date) {
          list.push({ title: norm(e.summary ?? ""), date: e.start.date, minutes: null });
        }
      }
    }
    dayCache.set(date, list);
    return list;
  }

  const results: AddEventResult[] = [];
  for (const ev of events.slice(0, 60)) {
    const title = (ev.title ?? "").trim().slice(0, 200);
    const start = ev.start && TIME.test(ev.start) ? ev.start : null;
    let end = ev.end && TIME.test(ev.end) ? ev.end : null;
    const base_ = { title, date: ev.date, start };
    if (!title || !DATE.test(ev.date ?? "")) {
      results.push({ ...base_, status: "error", error: "Needs a title and a date" });
      continue;
    }
    if (start && (!end || end <= start)) {
      // No end, or an end before the start: default to one hour.
      const [h, m] = start.split(":").map(Number);
      const mins = Math.min(h * 60 + m + 60, 23 * 60 + 59);
      end = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    }

    try {
      const startMin = start ? Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) : null;
      const dup = (await existingOn(ev.date)).some(
        (x) => x.date === ev.date && x.title === norm(title) && x.minutes === startMin
      );
      if (dup) {
        results.push({ ...base_, status: "duplicate" });
        continue;
      }

      const body: Record<string, unknown> = {
        summary: title,
        location: ev.location?.slice(0, 300) || undefined,
        description: ev.details?.slice(0, 2000) || undefined,
        start: start ? { dateTime: `${ev.date}T${start}:00`, timeZone: CALENDAR_TZ } : { date: ev.date },
        end: start ? { dateTime: `${ev.date}T${end}:00`, timeZone: CALENDAR_TZ } : { date: nextDate(ev.date) },
        extendedProperties: { private: { source: "stewardship-crm" } },
      };
      const res = await fetch(`${base}?sendUpdates=none`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        results.push({ ...base_, status: "error", error: j?.error?.message ?? `Google returned ${res.status}` });
        continue;
      }
      dayCache.get(ev.date)?.push({ title: norm(title), date: ev.date, minutes: startMin });
      results.push({ ...base_, status: "added", link: j.htmlLink ?? null });
    } catch (err) {
      results.push({ ...base_, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { account: row.email, results };
}
