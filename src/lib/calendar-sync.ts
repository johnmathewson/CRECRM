/**
 * Google Calendar → CRM, read-only.
 *
 * Reads John's personal calendar (the connected Google account that isn't
 * the business inbox, or CALENDAR_ACCOUNT when set) through the existing
 * Google connection once it carries calendar.readonly,
 * for a window of two weeks back and two weeks ahead. Each event is matched
 * against the CRM:
 *
 *   • attendees → known contacts (by email) → open deals where that contact
 *     is the client, or where they have a lead on the deal's property
 *   • title + location → a property with an open deal (street number and
 *     street name as whole words, or the property's name as a phrase)
 *
 * Only matched events are stored (calendar_events). Personal events never
 * leave Google. A matched event that has ended is logged once to the deal's
 * (or contact's) timeline (activities: tour / call / meeting), which the
 * nightly deal check-in and the deal page already read.
 *
 * Takes the Supabase client from the caller (service role) and imports
 * nothing from next/* — it runs inside Netlify functions.
 */

import { getActiveGmailTokens, PRIMARY_MAILBOX, tokenStore } from "@/lib/gmail-auth";
import { canReadCalendar } from "@/lib/google-oauth";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

/** Optional override. Default: the one connected account that isn't PRIMARY_MAILBOX. */
const CALENDAR_ACCOUNT_OVERRIDE = process.env.CALENDAR_ACCOUNT?.trim().toLowerCase() || null;

const WINDOW_BACK_DAYS = 14;
const WINDOW_AHEAD_DAYS = 14;

export interface CalendarSyncResult {
  account: string;
  skipped?: "not_connected" | "no_calendar_permission";
  fetched: number;
  matched: number;
  logged: number;
  error?: string;
}

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean; resource?: boolean }>;
  organizer?: { email?: string; displayName?: string; self?: boolean };
}

const STREET_WORDS = new Set([
  "st", "street", "rd", "road", "dr", "drive", "ave", "av", "avenue", "blvd", "boulevard", "ln", "lane",
  "ct", "court", "pl", "place", "way", "hwy", "highway", "pkwy", "parkway", "n", "s", "e", "w",
  "north", "south", "east", "west", "suite", "ste", "unit", "us", "sr", "route", "in", "il",
]);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

/** Street number and street name both present as whole words. */
function addressHit(address: string | null, text: Set<string>): boolean {
  if (!address) return false;
  const tokens = words(address.split(",")[0]);
  const numbers = tokens.filter((t) => /^\d+(-\d+)?$/.test(t)).flatMap((t) => t.split("-"));
  const street = tokens.filter((t) => !/^\d+(-\d+)?$/.test(t) && !STREET_WORDS.has(t));
  if (!numbers.length || !street.length) return false;
  return numbers.some((n) => text.has(n)) && street.every((t) => text.has(t));
}

function nameHit(name: string | null, textLower: string): boolean {
  if (!name) return false;
  const phrase = words(name).join(" ");
  if (phrase.length < 8 || /^\d/.test(phrase)) return false; // addresses-as-names go through addressHit
  return ` ${words(textLower).join(" ")} `.includes(` ${phrase} `);
}

function activityType(title: string): "tour" | "call" | "meeting" {
  const t = title.toLowerCase();
  if (/\b(tour|showing|walk ?through|site visit|inspection)\b/.test(t)) return "tour";
  if (/\b(call|phone|zoom|teams|google meet|meet)\b/.test(t)) return "call";
  return "meeting";
}

async function listEvents(accessToken: string, timeMin: string, timeMax: string): Promise<GEvent[]> {
  const out: GEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      showDeleted: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Calendar API ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as { items?: GEvent[]; nextPageToken?: string };
    out.push(...(j.items ?? []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/**
 * The Google connection whose calendar the CRM uses: CALENDAR_ACCOUNT when
 * set, else the one connected account that isn't the business inbox.
 * Shared with calendar-write so reading and adding use the same calendar.
 */
export async function calendarTokenRow(sb: any): Promise<{ email: string; scopes: string[] | null } | null> {
  const { data: tokenRows } = await tokenStore(sb)
    .from("gmail_oauth_tokens")
    .select("email, scopes")
    .eq("organization_id", ORG_ID)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });
  return (
    ((tokenRows ?? []) as any[]).find((r) =>
      CALENDAR_ACCOUNT_OVERRIDE ? r.email.toLowerCase() === CALENDAR_ACCOUNT_OVERRIDE : r.email.toLowerCase() !== PRIMARY_MAILBOX
    ) ?? null
  );
}

export async function syncCalendar(sb: any): Promise<CalendarSyncResult> {
  const tokenRow = await calendarTokenRow(sb);
  const account = (tokenRow?.email ?? CALENDAR_ACCOUNT_OVERRIDE ?? "").toLowerCase();
  const result: CalendarSyncResult = { account, fetched: 0, matched: 0, logged: 0 };
  if (!tokenRow) return { ...result, skipped: "not_connected" };
  if (!canReadCalendar(tokenRow.scopes)) return { ...result, skipped: "no_calendar_permission" };

  const tokens = await getActiveGmailTokens(sb);
  const token = tokens.find((t) => t.email.toLowerCase() === account);
  if (!token) return { ...result, skipped: "not_connected" };
  const ourEmails = new Set(tokens.map((t) => t.email.toLowerCase()));

  const now = Date.now();
  const events = await listEvents(
    token.accessToken,
    new Date(now - WINDOW_BACK_DAYS * 86400000).toISOString(),
    new Date(now + WINDOW_AHEAD_DAYS * 86400000).toISOString()
  );
  result.fetched = events.length;

  // ── What the CRM knows ────────────────────────────────────────────────
  const { data: dealRows } = await sb
    .from("deals")
    .select("id, created_at, property_id, client_contact_id, property:properties(id, name, address, is_dead)")
    .eq("organization_id", ORG_ID)
    .eq("is_closed", false)
    .eq("is_dead", false);
  const deals = ((dealRows ?? []) as any[])
    .filter((d) => !(d.property && d.property.is_dead))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const attendeeEmails = Array.from(
    new Set(
      events.flatMap((e) =>
        [...(e.attendees ?? []).map((a) => a.email), e.organizer?.email]
          .filter((x): x is string => !!x)
          .map((x) => x.toLowerCase())
          .filter((x) => !ourEmails.has(x))
      )
    )
  );
  const contactByEmail = new Map<string, { id: string; full_name: string | null }>();
  for (let i = 0; i < attendeeEmails.length; i += 100) {
    const { data } = await sb
      .from("contacts")
      .select("id, full_name, email")
      .eq("organization_id", ORG_ID)
      .in("email", attendeeEmails.slice(i, i + 100));
    for (const c of (data ?? []) as any[]) if (c.email) contactByEmail.set(c.email.toLowerCase(), c);
  }
  // Properties each known contact has a lead on — links a buyer touring a
  // listing to that listing's deal even when they aren't the deal's client.
  const contactIds = Array.from(new Set(Array.from(contactByEmail.values()).map((c) => c.id)));
  const leadProps = new Map<string, Set<string>>();
  if (contactIds.length) {
    const { data } = await sb
      .from("leads")
      .select("contact_id, property_id")
      .eq("organization_id", ORG_ID)
      .in("contact_id", contactIds)
      .not("property_id", "is", null);
    for (const l of (data ?? []) as any[]) {
      if (!leadProps.has(l.contact_id)) leadProps.set(l.contact_id, new Set());
      leadProps.get(l.contact_id)!.add(l.property_id);
    }
  }

  // ── Match ─────────────────────────────────────────────────────────────
  const rows: any[] = [];
  for (const e of events) {
    const startIso = e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null);
    if (!startIso) continue;
    const title = e.summary ?? "";
    const text = [title, e.location ?? "", (e.description ?? "").slice(0, 300)].join(" ");
    const textWords = new Set(words(text));

    const matchedContacts = [...(e.attendees ?? []).map((a) => a.email), e.organizer?.email]
      .filter((x): x is string => !!x)
      .map((x) => contactByEmail.get(x.toLowerCase()))
      .filter((c): c is { id: string; full_name: string | null } => !!c);
    const cIds = Array.from(new Set(matchedContacts.map((c) => c.id)));

    const propDeals = deals.filter((d) => d.property && (addressHit(d.property.address, textWords) || nameHit(d.property.name, text)));
    const contactDeals = deals.filter(
      (d) =>
        (d.client_contact_id && cIds.includes(d.client_contact_id)) ||
        (d.property_id && cIds.some((c) => leadProps.get(c)?.has(d.property_id)))
    );

    // Best deal: matched both ways, then by contact, then by place.
    const both = propDeals.find((d) => contactDeals.includes(d));
    const deal = both ?? contactDeals[0] ?? propDeals[0] ?? null;
    if (!deal && cIds.length === 0) continue; // personal — never stored

    const reasons = [
      cIds.length ? `attendee${cIds.length > 1 ? "s" : ""} ${matchedContacts.map((c) => c.full_name).filter(Boolean).join(", ")}` : null,
      propDeals.length ? `mentions ${propDeals[0].property.name ?? propDeals[0].property.address}` : null,
    ].filter(Boolean);

    rows.push({
      organization_id: ORG_ID,
      account,
      external_id: e.id,
      status: e.status ?? "confirmed",
      title: title.slice(0, 300) || null,
      location: e.location?.slice(0, 300) ?? null,
      description: e.description ? e.description.slice(0, 500) : null,
      start_at: startIso,
      end_at: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null),
      all_day: !e.start?.dateTime,
      attendees: (e.attendees ?? [])
        .filter((a) => a.email && !a.resource)
        .map((a) => ({ email: a.email!.toLowerCase(), name: a.displayName ?? null, response: a.responseStatus ?? null })),
      contact_ids: cIds,
      property_id: deal?.property_id ?? null,
      deal_id: deal?.id ?? null,
      match_reason: reasons.join("; ") || null,
      html_link: e.htmlLink ?? null,
      synced_at: new Date().toISOString(),
    });
  }
  result.matched = rows.length;
  if (!rows.length) return result;

  const { data: saved, error: upErr } = await sb
    .from("calendar_events")
    .upsert(rows, { onConflict: "organization_id,account,external_id" })
    .select("id, title, location, start_at, end_at, status, deal_id, property_id, contact_ids, attendees, activity_id");
  if (upErr) return { ...result, error: `calendar_events upsert: ${upErr.message}` };

  // ── Log ended meetings to the deal's timeline, once ───────────────────
  for (const ev of (saved ?? []) as any[]) {
    if (ev.activity_id || ev.status === "cancelled") continue;
    if (!ev.deal_id && !(ev.contact_ids ?? []).length) continue;
    const ended = new Date(ev.end_at ?? ev.start_at).getTime() < now;
    if (!ended) continue;
    const who = ((ev.attendees ?? []) as any[])
      .filter((a) => !ourEmails.has(a.email))
      .map((a) => a.name || a.email)
      .slice(0, 4)
      .join(", ");
    const { data: act, error: actErr } = await sb
      .from("activities")
      .insert({
        organization_id: ORG_ID,
        activity_type: activityType(ev.title ?? ""),
        subject: (ev.title || "Calendar event").slice(0, 300),
        body: ["From your calendar", ev.location, who ? `with ${who}` : null].filter(Boolean).join(" · "),
        occurred_at: ev.start_at,
        deal_id: ev.deal_id,
        property_id: ev.property_id,
        contact_id: (ev.contact_ids ?? [])[0] ?? null,
        created_by: USER_ID,
      })
      .select("id")
      .single();
    if (actErr || !act) continue;
    await sb.from("calendar_events").update({ activity_id: act.id }).eq("id", ev.id);
    result.logged++;
  }

  return result;
}
