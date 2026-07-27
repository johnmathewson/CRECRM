/**
 * GET /api/communications/coverage?days=30
 *
 * Answers "is anything falling through the cracks" with a number instead of
 * a hope. Lists what's actually in Gmail over the window and compares it to
 * what's in `communications`, in both directions.
 *
 * A message counts as logged when its Gmail message id appears in
 * communications.external_id — the same key every write path stamps.
 *
 * Known-and-intentional exclusions (NOT counted as gaps):
 *   - anything in SPAM / TRASH / DRAFT
 *   - mail we sent to ourselves (Steward briefs land via sendCrmEmail and are
 *     already logged; the SENT-sync skips them to avoid a double row)
 *
 * Anything else missing is a real gap worth looking at.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { getMessage, getHeader, parseAddress } from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// Gmail's list endpoint caps at 100 per page. Page through so the coverage
// number is trustworthy — a silently truncated check would defeat the point.
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // 1,000 messages per direction is plenty for any window

async function listAllMessageIds(
  accessToken: string,
  query: string,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(PAGE_SIZE),
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`Gmail list failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    for (const m of json.messages ?? []) ids.push(m.id);
    pages += 1;
    pageToken = json.nextPageToken;
    if (!pageToken) return { ids, truncated: false };
  }
  // Hit the page cap with more still available
  return { ids, truncated: true };
}

interface GapDetail {
  gmailMessageId: string;
  subject: string | null;
  counterparty: string | null;
  date: string | null;
}

/** Hydrate a bounded sample of gaps so the response is actionable, not just a count. */
async function describeGaps(
  accessToken: string,
  ids: string[],
  direction: "inbound" | "outbound",
  sampleSize: number,
): Promise<GapDetail[]> {
  const sample = ids.slice(0, sampleSize);
  const results = await Promise.allSettled(
    sample.map(async (id): Promise<GapDetail> => {
      const msg = await getMessage(accessToken, id);
      const headerName = direction === "outbound" ? "To" : "From";
      const parsed = parseAddress(getHeader(msg.payload, headerName));
      return {
        gmailMessageId: id,
        subject: getHeader(msg.payload, "Subject"),
        counterparty: parsed.email ?? parsed.name,
        date: getHeader(msg.payload, "Date"),
      };
    }),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

export async function GET(req: NextRequest) {
  const daysParam = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isFinite(daysParam)
    ? Math.min(Math.max(Math.trunc(daysParam), 1), 180)
    : 30;
  const sampleSize = Math.min(
    Number(req.nextUrl.searchParams.get("sample") ?? 20) || 20,
    50,
  );

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const token = await getActiveGmailToken(sb);
  if (!token) {
    return NextResponse.json(
      { error: "Gmail is not connected — cannot measure coverage." },
      { status: 503 },
    );
  }

  const cutoff = new Date(Date.now() - days * 86_400_000);
  const after = `${cutoff.getFullYear()}/${String(cutoff.getMonth() + 1).padStart(2, "0")}/${String(cutoff.getDate()).padStart(2, "0")}`;

  // What's in Gmail
  let sent: { ids: string[]; truncated: boolean };
  let received: { ids: string[]; truncated: boolean };
  try {
    [sent, received] = await Promise.all([
      listAllMessageIds(token.accessToken, `in:sent after:${after}`),
      listAllMessageIds(token.accessToken, `in:inbox after:${after}`),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // What's in the log. Pull external_ids for the window once and diff in
  // memory — cheaper and more accurate than a per-message existence query.
  const { data: loggedRows, error: logErr } = await sb
    .from("communications")
    .select("external_id")
    .eq("organization_id", ORG_ID)
    .gte("occurred_at", cutoff.toISOString())
    .not("external_id", "is", null);

  if (logErr) {
    return NextResponse.json({ error: logErr.message }, { status: 500 });
  }

  const logged = new Set(
    ((loggedRows ?? []) as { external_id: string }[]).map((r) => r.external_id),
  );

  const missingSent = sent.ids.filter((id) => !logged.has(id));
  const missingReceived = received.ids.filter((id) => !logged.has(id));

  const [sentGaps, receivedGaps] = await Promise.all([
    describeGaps(token.accessToken, missingSent, "outbound", sampleSize),
    describeGaps(token.accessToken, missingReceived, "inbound", sampleSize),
  ]);

  const pct = (logged_: number, total: number) =>
    total === 0 ? 100 : Math.round((logged_ / total) * 100);

  return NextResponse.json({
    window: { days, since: cutoff.toISOString().slice(0, 10) },
    mailbox: token.email,
    outbound: {
      inGmail: sent.ids.length,
      logged: sent.ids.length - missingSent.length,
      missing: missingSent.length,
      coveragePct: pct(sent.ids.length - missingSent.length, sent.ids.length),
      truncated: sent.truncated,
      sample: sentGaps,
    },
    inbound: {
      inGmail: received.ids.length,
      logged: received.ids.length - missingReceived.length,
      missing: missingReceived.length,
      coveragePct: pct(
        received.ids.length - missingReceived.length,
        received.ids.length,
      ),
      truncated: received.truncated,
      sample: receivedGaps,
    },
    notes: [
      "Excludes SPAM, TRASH and DRAFT by Gmail query.",
      "Mail sent to our own mailbox is skipped by the SENT sync to avoid duplicate rows — those may appear here as outbound gaps.",
      sampleSize < Math.max(missingSent.length, missingReceived.length)
        ? `Sample capped at ${sampleSize} per direction; counts above are complete.`
        : null,
    ].filter(Boolean),
  });
}
