/**
 * /api/communications/coverage
 *
 * GET  ?days=30&sample=20
 *   Answers "is anything falling through the cracks" with a number instead of
 *   a hope. Lists what's actually in Gmail over the window and compares it to
 *   what's in `communications`, in both directions.
 *
 *   A message counts as logged when its Gmail message id appears in
 *   communications.external_id — the same key every write path stamps.
 *
 *   Inbound gaps are cross-checked against `email_ingest_log`: a gap with a
 *   disposition row is EXPLAINED (we saw it and chose not to log it — e.g. a
 *   CREXi report or classifier-dropped noise); a gap missing from both tables
 *   is UNEXPLAINED and is a real bug.
 *
 *   Also sweeps `in:spam` for senders who exist in contacts/leads — real
 *   people whose mail Gmail buried where the poller never looks.
 *
 * POST { days?, direction?: "both"|"inbound"|"outbound", limit?, dryRun? }
 *   Backfill mode. Recomputes the same diff and writes the missing messages
 *   into `communications`, matching contact → lead → property by counterparty
 *   email. Idempotent: re-checks external_id before every insert. Rows are
 *   stamped raw_payload.source = "coverage_backfill" so they're auditable.
 *
 * Known-and-intentional exclusions (NOT counted as gaps):
 *   - anything in SPAM / TRASH / DRAFT (spam gets its own review section)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import {
  getMessage,
  getHeader,
  parseAddress,
  extractBody,
  extractAttachments,
} from "@/lib/gmail";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// Gmail's list endpoint caps at 100 per page. Page through so the coverage
// number is trustworthy — a silently truncated check would defeat the point.
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // 1,000 messages per direction is plenty for any window
const SPAM_MAX_PAGES = 3; // spam is bounded separately — we only sample it

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any, any, any>;

function sb(): SB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

async function listAllMessageIds(
  accessToken: string,
  query: string,
  maxPages = MAX_PAGES,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
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

function gmailAfter(cutoff: Date): string {
  return `${cutoff.getFullYear()}/${String(cutoff.getMonth() + 1).padStart(2, "0")}/${String(cutoff.getDate()).padStart(2, "0")}`;
}

/** Compute the Gmail-vs-communications diff once; shared by GET and POST. */
async function computeDiff(accessToken: string, supabase: SB, days: number) {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const after = gmailAfter(cutoff);

  const [sent, received] = await Promise.all([
    listAllMessageIds(accessToken, `in:sent after:${after}`),
    listAllMessageIds(accessToken, `in:inbox after:${after}`),
  ]);

  // What's in the log. Pull external_ids for the window once and diff in
  // memory — cheaper and more accurate than a per-message existence query.
  const { data: loggedRows, error: logErr } = await supabase
    .from("communications")
    .select("external_id")
    .eq("organization_id", ORG_ID)
    .gte("occurred_at", cutoff.toISOString())
    .not("external_id", "is", null);
  if (logErr) throw new Error(logErr.message);

  const logged = new Set(
    ((loggedRows ?? []) as { external_id: string }[]).map((r) => r.external_id),
  );

  return {
    cutoff,
    after,
    sent,
    received,
    missingSent: sent.ids.filter((id) => !logged.has(id)),
    missingReceived: received.ids.filter((id) => !logged.has(id)),
  };
}

/**
 * Look up ingest-log dispositions for a set of Gmail message ids.
 * Returns a map id → disposition. Chunked to keep .in() lists sane.
 */
async function ingestDispositions(
  supabase: SB,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data } = await supabase
      .from("email_ingest_log")
      .select("gmail_message_id, disposition")
      .in("gmail_message_id", chunk);
    for (const row of (data ?? []) as {
      gmail_message_id: string;
      disposition: string;
    }[]) {
      // Keep the first (most useful) disposition if a message was logged twice
      if (!map.has(row.gmail_message_id)) {
        map.set(row.gmail_message_id, row.disposition);
      }
    }
  }
  return map;
}

interface GapDetail {
  gmailMessageId: string;
  subject: string | null;
  counterparty: string | null;
  date: string | null;
  /** Inbound only — why the poller intentionally skipped it, if it did. */
  disposition?: string | null;
}

/** Hydrate a bounded sample of gaps so the response is actionable, not just a count. */
async function describeGaps(
  accessToken: string,
  ids: string[],
  direction: "inbound" | "outbound",
  sampleSize: number,
  dispositions?: Map<string, string>,
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
        ...(dispositions
          ? { disposition: dispositions.get(id) ?? null }
          : {}),
      };
    }),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/**
 * Spam review: hydrate recent in:spam senders and flag any that exist in
 * contacts or leads — a real relationship whose mail Gmail buried.
 */
async function reviewSpam(
  accessToken: string,
  supabase: SB,
  after: string,
  sampleSize: number,
): Promise<{
  inGmail: number;
  reviewed: number;
  truncated: boolean;
  knownSenders: {
    gmailMessageId: string;
    from: string | null;
    subject: string | null;
    date: string | null;
    matchedIn: string[];
  }[];
}> {
  const spam = await listAllMessageIds(
    accessToken,
    `in:spam after:${after}`,
    SPAM_MAX_PAGES,
  );

  const sample = spam.ids.slice(0, sampleSize);
  const hydrated = await Promise.allSettled(
    sample.map(async (id) => {
      const msg = await getMessage(accessToken, id);
      const parsed = parseAddress(getHeader(msg.payload, "From"));
      return {
        gmailMessageId: id,
        from: parsed.email,
        fromDisplay: parsed.email ?? parsed.name,
        subject: getHeader(msg.payload, "Subject"),
        date: getHeader(msg.payload, "Date"),
      };
    }),
  );
  const rows = hydrated.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : [],
  );

  // PostgREST .or() syntax breaks on commas/parens — such strings aren't
  // valid emails anyway, so drop them rather than corrupt the filter.
  const emails = Array.from(
    new Set(
      rows
        .map((r) => r.from?.toLowerCase().trim())
        .filter((e): e is string => !!e && !/[,()]/.test(e)),
    ),
  );

  const known = new Map<string, Set<string>>(); // email → tables it appears in
  if (emails.length > 0) {
    const orFilter = (col: string) =>
      emails.map((e) => `${col}.ilike.${e}`).join(",");

    const [{ data: contactHits }, { data: leadHits }] = await Promise.all([
      supabase
        .from("contacts")
        .select("email")
        .eq("organization_id", ORG_ID)
        .or(orFilter("email")),
      supabase
        .from("leads")
        .select("sender_email")
        .eq("organization_id", ORG_ID)
        .or(orFilter("sender_email")),
    ]);
    for (const c of (contactHits ?? []) as { email: string | null }[]) {
      if (!c.email) continue;
      const k = c.email.toLowerCase();
      if (!known.has(k)) known.set(k, new Set());
      known.get(k)!.add("contacts");
    }
    for (const l of (leadHits ?? []) as { sender_email: string | null }[]) {
      if (!l.sender_email) continue;
      const k = l.sender_email.toLowerCase();
      if (!known.has(k)) known.set(k, new Set());
      known.get(k)!.add("leads");
    }
  }

  const knownSenders = rows
    .filter((r) => r.from && known.has(r.from.toLowerCase()))
    .map((r) => ({
      gmailMessageId: r.gmailMessageId,
      from: r.fromDisplay,
      subject: r.subject,
      date: r.date,
      matchedIn: Array.from(known.get(r.from!.toLowerCase()) ?? []),
    }));

  return {
    inGmail: spam.ids.length,
    reviewed: rows.length,
    truncated: spam.truncated,
    knownSenders,
  };
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

  const supabase = sb();

  const token = await getActiveGmailToken(supabase);
  if (!token) {
    return NextResponse.json(
      { error: "Gmail is not connected — cannot measure coverage." },
      { status: 503 },
    );
  }

  let diff: Awaited<ReturnType<typeof computeDiff>>;
  try {
    diff = await computeDiff(token.accessToken, supabase, days);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const { sent, received, missingSent, missingReceived, cutoff, after } = diff;

  // Explain inbound gaps via the ingest log: seen-and-skipped vs never-seen.
  const dispositions = await ingestDispositions(supabase, missingReceived);
  const explainedCounts: Record<string, number> = {};
  let unexplained = 0;
  for (const id of missingReceived) {
    const d = dispositions.get(id);
    if (d) explainedCounts[d] = (explainedCounts[d] ?? 0) + 1;
    else unexplained += 1;
  }

  const [sentGaps, receivedGaps, spamReview] = await Promise.all([
    describeGaps(token.accessToken, missingSent, "outbound", sampleSize),
    describeGaps(
      token.accessToken,
      missingReceived,
      "inbound",
      sampleSize,
      dispositions,
    ),
    reviewSpam(token.accessToken, supabase, after, 30),
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
      // Seen by the poller and intentionally skipped, keyed by why
      explained: explainedCounts,
      // Missing from communications AND email_ingest_log — a real bug
      unexplained,
      sample: receivedGaps,
    },
    spam: spamReview,
    notes: [
      "Excludes SPAM, TRASH and DRAFT by Gmail query — spam has its own review section.",
      "Inbound gaps with a disposition were seen and intentionally skipped (CREXi reports, classifier drops, unsubscribes); 'unexplained' gaps predate the ingest log or indicate a bug.",
      "POST to this endpoint to backfill missing messages into communications.",
      sampleSize < Math.max(missingSent.length, missingReceived.length)
        ? `Sample capped at ${sampleSize} per direction; counts above are complete.`
        : null,
    ].filter(Boolean),
  });
}

// ── Backfill ─────────────────────────────────────────────────────────────────

interface BackfillBody {
  days?: number;
  direction?: "both" | "inbound" | "outbound";
  limit?: number;
  dryRun?: boolean;
}

export async function POST(req: NextRequest) {
  let body: BackfillBody;
  try {
    body = (await req.json()) as BackfillBody;
  } catch {
    body = {};
  }

  const days = Math.min(Math.max(Math.trunc(body.days ?? 30), 1), 180);
  const direction = body.direction ?? "both";
  // Each message needs a Gmail fetch + 2-3 DB queries; keep well inside the
  // 60s function budget. Run POST repeatedly to work through a big backlog.
  const limit = Math.min(Math.max(Math.trunc(body.limit ?? 50), 1), 150);
  const dryRun = body.dryRun === true;

  const supabase = sb();
  const token = await getActiveGmailToken(supabase);
  if (!token) {
    return NextResponse.json(
      { error: "Gmail is not connected — cannot backfill." },
      { status: 503 },
    );
  }

  let diff: Awaited<ReturnType<typeof computeDiff>>;
  try {
    diff = await computeDiff(token.accessToken, supabase, days);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const work: { id: string; direction: "inbound" | "outbound" }[] = [];
  if (direction !== "inbound") {
    for (const id of diff.missingSent) work.push({ id, direction: "outbound" });
  }
  if (direction !== "outbound") {
    for (const id of diff.missingReceived)
      work.push({ id, direction: "inbound" });
  }
  const batch = work.slice(0, limit);
  const remaining = work.length - batch.length;

  const results = {
    backfilled: 0,
    skippedAlreadyLogged: 0,
    errors: [] as { gmailMessageId: string; error: string }[],
    rows: [] as {
      gmailMessageId: string;
      direction: string;
      subject: string | null;
      counterparty: string | null;
      matchedContact: boolean;
      matchedLead: boolean;
    }[],
  };

  for (const item of batch) {
    try {
      // Idempotency re-check — another poller tick may have logged it since
      // the diff was computed.
      const { data: existing } = await supabase
        .from("communications")
        .select("id")
        .eq("external_id", item.id)
        .maybeSingle();
      if (existing) {
        results.skippedAlreadyLogged += 1;
        continue;
      }

      const msg = await getMessage(token.accessToken, item.id);
      const subject = getHeader(msg.payload, "Subject");
      const fromParsed = parseAddress(getHeader(msg.payload, "From"));
      const toHeader = getHeader(msg.payload, "To");
      const toParsed = parseAddress(toHeader);
      const counterparty =
        item.direction === "outbound" ? toParsed.email : fromParsed.email;
      const { text } = extractBody(msg.payload);
      const occurredAt = msg.internalDate
        ? new Date(Number(msg.internalDate)).toISOString()
        : new Date().toISOString();

      // Match contact → lead → property by counterparty email
      let contactId: string | null = null;
      let leadId: string | null = null;
      let propertyId: string | null = null;
      if (counterparty) {
        const { data: ct } = await supabase
          .from("contacts")
          .select("id")
          .eq("organization_id", ORG_ID)
          .ilike("email", counterparty.trim())
          .limit(1)
          .maybeSingle();
        contactId = (ct as { id: string } | null)?.id ?? null;

        const { data: lead } = await supabase
          .from("leads")
          .select("id, property_id")
          .eq("organization_id", ORG_ID)
          .ilike("sender_email", counterparty.trim())
          .not("status", "in", '("archived","spam")')
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lead) {
          leadId = (lead as { id: string }).id;
          propertyId = (lead as { property_id: string | null }).property_id;
        }
      }

      results.rows.push({
        gmailMessageId: item.id,
        direction: item.direction,
        subject,
        counterparty: counterparty ?? null,
        matchedContact: !!contactId,
        matchedLead: !!leadId,
      });

      if (dryRun) continue;

      const { error: insErr } = await supabase.from("communications").insert({
        organization_id: ORG_ID,
        lead_id: leadId,
        contact_id: contactId,
        property_id: propertyId,
        channel: "email",
        direction: item.direction,
        external_id: item.id,
        subject,
        body_preview: (text || "").slice(0, 500),
        from_address: fromParsed.email,
        ...(item.direction === "outbound" && toParsed.email
          ? { to_addresses: [toParsed.email] }
          : {}),
        occurred_at: occurredAt,
        // Backfilled outbound defaults to 'manual' — the safest bucket; the
        // real kind is unknowable after the fact. Inbound has no touch_kind.
        ...(item.direction === "outbound" ? { touch_kind: "manual" } : {}),
        attachments: extractAttachments(msg.payload),
        raw_payload: {
          gmail_message_id: msg.id,
          gmail_thread_id: msg.threadId,
          label_ids: msg.labelIds,
          source: "coverage_backfill",
          to_header: toHeader,
        },
      });
      if (insErr) throw new Error(insErr.message);
      results.backfilled += 1;
    } catch (err) {
      results.errors.push({
        gmailMessageId: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    window: { days, since: diff.cutoff.toISOString().slice(0, 10) },
    direction,
    dryRun,
    attempted: batch.length,
    remaining,
    ...results,
  });
}
