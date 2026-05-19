/**
 * POST /api/cron/poll-gmail
 *
 * The heartbeat. Runs every minute (triggered by netlify/functions/poll-gmail).
 * Two jobs:
 *
 *   1. Poll the connected Gmail mailbox via history.list since last_history_id.
 *      For each new inbound message (filtering out our own sent items and
 *      anything in SENT/DRAFT labels), POST a normalized payload to
 *      /api/leads/intake — same dedup + qualification + draft pipeline as
 *      the test seeder.
 *
 *   2. Drain the scheduled_acks queue: send any auto-acknowledgments where
 *      send_after has passed and sent_at is null.
 *
 * Auth: requires x-cron-secret header matching CRON_SECRET env var.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import {
  getProfile,
  listHistory,
  getMessage,
  getHeader,
  extractBody,
  parseAddress,
} from "@/lib/gmail";
import { maybeRouteAsReply } from "@/lib/cre-os/match-reply-to-touch";

// Walk a Gmail message payload tree looking for an attachment whose
// filename matches a CREXi Lead Report pattern. CREXi sends the file with
// two different naming conventions depending on which export path was used:
//   - "Lead Report - Super 8 by Wyndham Valparaiso.xlsx"   (spaces + hyphen)
//   - "Lead_Report_Liberty_Square_Retail_Center.xlsx"      (underscores)
// We accept either, plus minor variants ("Lead-Report" with hyphens, etc).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasLeadReportXlsx(payload: any): boolean {
  if (!payload) return false;
  const fn: string | undefined = payload.filename;
  if (fn) {
    // Normalize: lower-case + collapse common separators (_, -, .) to spaces
    // so "Lead_Report_X.xlsx" reads as "lead report x.xlsx" for matching.
    const normalized = fn.toLowerCase().replace(/[_\-.]+/g, " ").trim();
    if (/^lead report\b/.test(normalized) && /xlsx\b/.test(normalized)) return true;
  }
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      if (hasLeadReportXlsx(p)) return true;
    }
  }
  return false;
}

// Secondary signal: even if filename matching fails (e.g. the file was
// renamed by a forwarder), an email with subject "Lead Report" + any XLSX
// attachment is almost certainly a CREXi export. Belt + suspenders.
function looksLikeLeadReportEmail(subject: string | null, payload: unknown): boolean {
  if (!subject) return false;
  if (!/lead\s*report/i.test(subject)) return false;
  return hasAnyXlsxAttachment(payload);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAnyXlsxAttachment(payload: any): boolean {
  if (!payload) return false;
  const fn: string | undefined = payload.filename;
  if (fn && /\.xlsx$/i.test(fn)) return true;
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      if (hasAnyXlsxAttachment(p)) return true;
    }
  }
  return false;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface PollResult {
  ok: boolean;
  poll: {
    skipped?: string;
    new_messages?: number;
    cursor_advanced_to?: string;
    error?: string;
  };
  acks: {
    drained?: number;
    failed?: number;
    error?: string;
  };
  duration_ms: number;
}

export async function POST(req: NextRequest): Promise<NextResponse<PollResult>> {
  const started = Date.now();

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== cronSecret) {
      return NextResponse.json(
        { ok: false, poll: { error: "unauthorized" }, acks: {}, duration_ms: 0 },
        { status: 401 }
      );
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const result: PollResult = {
    ok: true,
    poll: {},
    acks: {},
    duration_ms: 0,
  };

  // ── Job 1: Poll Gmail ────────────────────────────────────────────────────
  let token;
  try {
    token = await getActiveGmailToken(supabase);
  } catch (err: any) {
    result.poll.error = `Token refresh failed: ${err.message}`;
    token = null;
  }

  if (!token) {
    result.poll.skipped = "no_active_token";
  } else if (!token.lastHistoryId) {
    // No cursor yet — initialize from current profile.
    try {
      const profile = await getProfile(token.accessToken);
      await supabase
        .from("gmail_oauth_tokens")
        .update({
          last_history_id: profile.historyId,
          last_polled_at: new Date().toISOString(),
          poll_error: null,
        })
        .eq("id", token.rowId);
      result.poll.skipped = "initialized_cursor";
      result.poll.cursor_advanced_to = profile.historyId;
    } catch (err: any) {
      result.poll.error = `Profile fetch failed: ${err.message}`;
      await supabase.from("gmail_oauth_tokens").update({ poll_error: err.message }).eq("id", token.rowId);
    }
  } else {
    try {
      const newMessages: { id: string; threadId: string }[] = [];
      let pageToken: string | undefined;
      let latestHistoryId: string | null = null;

      do {
        const page = await listHistory(token.accessToken, token.lastHistoryId, pageToken);
        if (page.historyId) latestHistoryId = page.historyId;
        for (const record of page.history || []) {
          for (const added of record.messagesAdded || []) {
            const msg = added.message;
            // Filter: don't ingest our own outbound (SENT label) or drafts.
            const labels = msg.labelIds || [];
            if (labels.includes("SENT") || labels.includes("DRAFT") || labels.includes("TRASH") || labels.includes("SPAM")) continue;
            newMessages.push({ id: msg.id, threadId: msg.threadId });
          }
        }
        pageToken = page.nextPageToken;
      } while (pageToken);

      // Fetch each new message + dispatch to intake. Done sequentially to avoid
      // hammering Gmail's quota and to keep ordering stable.
      const origin = req.nextUrl.origin;
      let dispatched = 0;
      for (const msgRef of newMessages) {
        try {
          const msg = await getMessage(token.accessToken, msgRef.id);
          const fromHeader = getHeader(msg.payload, "From");
          const toHeader = getHeader(msg.payload, "To");
          const subject = getHeader(msg.payload, "Subject");
          const messageIdHeader = getHeader(msg.payload, "Message-ID");
          const { name: fromName, email: fromEmail } = parseAddress(fromHeader);

          // Skip: our own outbound shouldn't appear here (filtered above), but
          // double-check — anything from our connected mailbox is us.
          if (fromEmail && fromEmail.toLowerCase() === token.email.toLowerCase()) continue;

          const { text, html } = extractBody(msg.payload);

          // ── First try: is this a REPLY to a cadence touch the agent sent? ──
          // If yes, route as reply (logs into lane_touches + flips enrollment
          // to engaged + writes activity). If no, fall through to the normal
          // unsolicited-lead intake path.
          const replyResult = await maybeRouteAsReply(supabase, {
            gmailMessageId: msg.id,
            gmailThreadId: msg.threadId,
            fromEmail,
            fromName,
            subject,
            bodyText: text || "",
            receivedAt: new Date().toISOString(),
          });

          if (replyResult.matched) {
            dispatched += 1;
            continue; // skip lead-intake — this was a reply
          }

          // ── Second try: is this a CREXi daily Lead Report? ──
          // Two-signal detection:
          //   1. Attachment filename matches lead-report patterns
          //      ("Lead Report - X.xlsx" or "Lead_Report_X.xlsx")
          //   2. OR: email subject contains "Lead Report" AND has an
          //      xlsx attachment (fallback for renamed/forwarded files)
          // If yes → route to the report parser instead of lead intake.
          const hasCrexiReportAttachment =
            hasLeadReportXlsx(msg.payload) ||
            looksLikeLeadReportEmail(subject, msg.payload);
          if (hasCrexiReportAttachment) {
            try {
              const reportRes = await fetch(`${origin}/api/leads/crexi-report`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gmail_message_id: msg.id }),
              });
              if (reportRes.ok) {
                dispatched += 1;
                continue;
              }
              // If report parse fails, fall through to normal lead intake
              // so we don't drop the message entirely.
              console.warn(`[poll-gmail] CREXi report parse failed for ${msg.id}, falling through to lead intake`);
            } catch (err) {
              console.error(`[poll-gmail] CREXi report dispatch error:`, err);
            }
          }

          const intakePayload = {
            source: "email",
            sender_name: fromName,
            sender_email: fromEmail,
            sender_phone: null,
            raw_subject: subject,
            raw_body: text,
            source_message_id: msg.id,
            raw_payload: {
              gmail_message_id: msg.id,
              gmail_thread_id: msg.threadId,
              labels: msg.labelIds,
              headers: {
                "Message-ID": messageIdHeader,
                From: fromHeader,
                To: toHeader,
                Subject: subject,
              },
              has_html: !!html,
            },
          };

          const intakeRes = await fetch(`${origin}/api/leads/intake`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(intakePayload),
          });
          if (intakeRes.ok) dispatched += 1;
        } catch (err) {
          // Log but keep going — single message failure shouldn't break the loop
          console.error(`[poll-gmail] failed to ingest message ${msgRef.id}:`, err);
        }
      }

      // Advance cursor to the latest history ID we saw, or current profile.
      const cursor = latestHistoryId || (await getProfile(token.accessToken)).historyId;
      await supabase
        .from("gmail_oauth_tokens")
        .update({
          last_history_id: cursor,
          last_polled_at: new Date().toISOString(),
          poll_error: null,
        })
        .eq("id", token.rowId);

      result.poll.new_messages = dispatched;
      result.poll.cursor_advanced_to = cursor;
    } catch (err: any) {
      result.poll.error = err.message;
      const errMsg = err.message || "unknown poll error";
      // 404 on history typically means cursor is too old (Gmail keeps ~7 days).
      // Reset to current profile historyId on next run.
      const isStale = /historyId/i.test(errMsg) && /not found|404/i.test(errMsg);
      if (isStale) {
        try {
          const profile = await getProfile(token.accessToken);
          await supabase
            .from("gmail_oauth_tokens")
            .update({
              last_history_id: profile.historyId,
              poll_error: `Stale cursor reset: ${errMsg}`,
              last_polled_at: new Date().toISOString(),
            })
            .eq("id", token.rowId);
        } catch {
          await supabase.from("gmail_oauth_tokens").update({ poll_error: errMsg }).eq("id", token.rowId);
        }
      } else {
        await supabase.from("gmail_oauth_tokens").update({ poll_error: errMsg }).eq("id", token.rowId);
      }
    }
  }

  // ── Job 2: Drain scheduled_acks ──────────────────────────────────────────
  try {
    const { data: due } = await supabase
      .from("scheduled_acks")
      .select("id, lead_id, attempts")
      .lte("send_after", new Date().toISOString())
      .is("sent_at", null)
      .lt("attempts", 3)
      .order("send_after", { ascending: true })
      .limit(20);

    let drained = 0;
    let failed = 0;
    const origin = req.nextUrl.origin;

    for (const ack of due || []) {
      // Increment attempts before sending so a crash mid-send doesn't loop forever
      await supabase
        .from("scheduled_acks")
        .update({ attempts: (ack.attempts || 0) + 1 })
        .eq("id", ack.id);

      try {
        const res = await fetch(`${origin}/api/leads/${ack.lead_id}/ack`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret": cronSecret || "",
          },
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && (body.ok || body.already_sent || body.skipped)) {
          await supabase
            .from("scheduled_acks")
            .update({ sent_at: new Date().toISOString(), error: null })
            .eq("id", ack.id);
          drained += 1;
        } else {
          await supabase
            .from("scheduled_acks")
            .update({ error: body.error || `HTTP ${res.status}` })
            .eq("id", ack.id);
          failed += 1;
        }
      } catch (err: any) {
        await supabase
          .from("scheduled_acks")
          .update({ error: err.message || "unknown" })
          .eq("id", ack.id);
        failed += 1;
      }
    }

    result.acks.drained = drained;
    result.acks.failed = failed;
  } catch (err: any) {
    result.acks.error = err.message;
  }

  result.duration_ms = Date.now() - started;
  return NextResponse.json(result);
}

// Allow GET for manual debugging — same handler, just a different verb.
// This way you can hit /api/cron/poll-gmail in a browser (with x-cron-secret
// in a header via curl) to test without setting up the Netlify function.
export async function GET(req: NextRequest) {
  return POST(req);
}
