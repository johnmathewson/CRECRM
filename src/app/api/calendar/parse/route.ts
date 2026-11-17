/**
 * POST /api/calendar/parse
 *
 * Turns a schedule John has — pasted text, a PDF, or a photo/screenshot —
 * into a list of calendar events for him to review on /cre-os/calendar.
 * Nothing is added here; ../events does that after he confirms.
 *
 * Body: { text?: string, file?: { name, type, data /* base64 *\/ } }
 * Returns: { events: NewCalendarEvent[], note?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";
import { chicagoDate } from "@/lib/agents/deal-checkin";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const SYSTEM = `You read schedules, invitations and plans and turn them into calendar events for a commercial real estate broker in Northwest Indiana (Central time).

Return ONLY JSON:
{
  "events": [
    { "title": "...", "date": "YYYY-MM-DD", "start": "HH:MM" | null, "end": "HH:MM" | null, "location": "..." | null, "details": "..." | null }
  ],
  "note": "one short sentence only if something was ambiguous (e.g. an assumed year or AM/PM), else null"
}

Rules:
- One event per scheduled item: sessions, talks, worship, meals and breaks, meetings, calls, tours. Skip note-taking areas, blank sections, headings, sponsor text and decorative copy.
- If the user's text says what to include or leave out, follow it.
- 24-hour times, as printed in the source's local time. Use context for AM/PM (a 2:00–3:30 session after a 12:30 lunch is 14:00–15:30).
- title: the item's name only. Put the speaker/presenter/host in details, not the title. If the document is clearly one event series (a conference), prefix titles with its short name, e.g. "GFJ · Worship".
- location: the venue if the source gives one (apply a single venue to every item).
- No start/end time printed → null for both (all-day).
- Resolve dates against today's date (given below). A date without a year is the next upcoming one.
- Never invent items, times or places that aren't in the source.`;

export async function POST(req: NextRequest) {
  const { data: { user } } = await createServerSupabase().auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { text?: string; file?: { name?: string; type?: string; data?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = (body.text ?? "").trim().slice(0, 20000);
  const file = body.file?.data ? body.file : null;
  if (!text && !file) return NextResponse.json({ error: "Paste something or attach a file." }, { status: 400 });

  const content: any[] = [];
  if (file) {
    const bytes = Math.floor((file.data!.length * 3) / 4);
    if (bytes > MAX_FILE_BYTES) return NextResponse.json({ error: "That file is over 4 MB. Try a screenshot instead." }, { status: 413 });
    const type = (file.type ?? "").toLowerCase();
    if (type === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } });
    } else if (IMAGE_TYPES.includes(type)) {
      content.push({ type: "image", source: { type: "base64", media_type: type, data: file.data } });
    } else {
      return NextResponse.json({ error: "Attach a PDF or an image (PNG, JPG, WebP)." }, { status: 415 });
    }
  }
  content.push({
    type: "text",
    text: `Today: ${chicagoDate()}\n\n${text ? `From the user:\n${text}` : "Turn the attached schedule into events."}`,
  });

  try {
    const res = await callAnthropic({
      model: MODELS.SONNET,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      maxTokens: 4000,
      temperature: 0,
    });
    const j = parseJsonResponse<any>(res.text);
    if (!j || !Array.isArray(j.events)) {
      return NextResponse.json({ error: "Couldn't read any events from that. Try pasting the text." }, { status: 422 });
    }
    const events = (j.events as any[])
      .filter((e) => e && typeof e.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ""))
      .slice(0, 60)
      .map((e) => ({
        title: String(e.title).slice(0, 200),
        date: e.date,
        start: typeof e.start === "string" && /^\d{2}:\d{2}$/.test(e.start) ? e.start : null,
        end: typeof e.end === "string" && /^\d{2}:\d{2}$/.test(e.end) ? e.end : null,
        location: e.location ? String(e.location).slice(0, 300) : null,
        details: e.details ? String(e.details).slice(0, 500) : null,
      }));
    return NextResponse.json({ events, note: typeof j.note === "string" ? j.note : null });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
