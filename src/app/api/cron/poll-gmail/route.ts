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
import { getActiveGmailToken, getActiveGmailTokens, PRIMARY_MAILBOX } from "@/lib/gmail-auth";
import {
  getProfile,
  listHistory,
  listMessages,
  getMessage,
  getHeader,
  extractBody,
  extractAttachments,
  parseAddress,
} from "@/lib/gmail";
import { maybeRouteAsReply, routeAsReplyByEmail } from "@/lib/cre-os/match-reply-to-touch";
import { captureVoiceExample } from "@/lib/cre-os/voice-examples";
import {
  classifyInboundEmail,
  collectAttachmentFilenames,
  type InboundClassification,
} from "@/lib/cre-os/classify-inbound-email";

// Walk a Gmail message payload tree looking for an attachment whose
// filename matches a CREXi Lead Report pattern. CREXi sends the file with
// two different naming conventions depending on which export path was used:
//   - "Lead Report - Super 8 by Wyndham Valparaiso.xlsx"   (spaces + hyphen)
//   - "Lead_Report_Liberty_Square_Retail_Center.xlsx"      (underscores)
//   - "Master_Lead_Report.csv"                             (all-property CSV export)
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

// Same check for CSV format — CREXi now also exports as CSV.
// Matches "Lead Report *.csv", "Master_Lead_Report.csv", etc.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasLeadReportCsv(payload: any): boolean {
  if (!payload) return false;
  const fn: string | undefined = payload.filename;
  if (fn) {
    const normalized = fn.toLowerCase().replace(/[_\-.]+/g, " ").trim();
    if (/lead report/.test(normalized) && /csv\b/.test(normalized)) return true;
    if (/master lead report/.test(normalized)) return true;
  }
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      if (hasLeadReportCsv(p)) return true;
    }
  }
  return false;
}

// Secondary signal: even if filename matching fails (e.g. the file was
// renamed by a forwarder), an email with subject "Lead Report" + any XLSX
// or CSV attachment is almost certainly a CREXi export. Belt + suspenders.
function looksLikeLeadReportEmail(subject: string | null, payload: unknown): boolean {
  if (!subject) return false;
  if (!/lead\s*report/i.test(subject)) return false;
  return hasAnyXlsxAttachment(payload) || hasAnyCsvAttachment(payload);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAnyCsvAttachment(payload: any): boolean {
  if (!payload) return false;
  const fn: string | undefined = payload.filename;
  if (fn && /\.csv$/i.test(fn)) return true;
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      if (hasAnyCsvAttachment(p)) return true;
    }
  }
  return false;
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

/**
 * Record what the poller decided about a message. Fire-and-forget by
 * design: the audit trail must never break ingestion, so failures are
 * logged to console and swallowed.
 *
 * The contract this enforces: any Gmail message missing from
 * `communications` should have a row HERE explaining why. Missing from
 * both tables = a real coverage bug. The /api/communications/coverage
 * check joins against this table to split "missing but explained" from
 * "missing and unexplained".
 */
async function logIngest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  entry: {
    gmailMessageId: string;
    gmailThreadId?: string | null;
    fromAddress?: string | null;
    subject?: string | null;
    disposition:
      | "routed_as_reply"
      | "crexi_report"
      | "lead_intake"
      | "intake_rejected"
      | "dropped_by_classifier"
      | "unsubscribe"
      | "skipped_label"
      | "skipped_self"
      | "error";
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await supabase.from("email_ingest_log").insert({
      organization_id: ORG_ID,
      gmail_message_id: entry.gmailMessageId,
      gmail_thread_id: entry.gmailThreadId ?? null,
      from_address: entry.fromAddress ?? null,
      subject: entry.subject ?? null,
      disposition: entry.disposition,
      detail: entry.detail ?? {},
    });
  } catch (err) {
    console.error("[poll-gmail] ingest-log write failed:", err);
  }
}

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
  /** Per-mailbox results — SENT-sync runs on EVERY connected account so
   *  replies John sends from john@ (not just inquiries@) get logged. */
  sentSync: Record<string, {
    synced?: number;
    skipped?: number;
    error?: string;
  }>;
  duration_ms: number;
}

export async function POST(req: NextRequest): Promise<NextResponse<PollResult>> {
  const started = Date.now();

  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  if (!cronSecret || provided !== cronSecret) {
    return NextResponse.json(
      { ok: false, poll: { error: "unauthorized" }, acks: {}, sentSync: {}, duration_ms: 0 },
      { status: 401 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const result: PollResult = {
    ok: true,
    poll: {},
    acks: {},
    sentSync: {},
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
            if (labels.includes("SENT") || labels.includes("DRAFT") || labels.includes("TRASH") || labels.includes("SPAM")) {
              // Audit only the interesting skips. SENT/DRAFT are structural
              // noise (our own outbound is already logged by the send paths);
              // SPAM/TRASH skips are the ones worth explaining later — a real
              // inquiry Gmail misfiled lands here, and the coverage check's
              // spam review reads this trail.
              if (labels.includes("SPAM") || labels.includes("TRASH")) {
                await logIngest(supabase, {
                  gmailMessageId: msg.id,
                  gmailThreadId: msg.threadId,
                  disposition: "skipped_label",
                  detail: { labels },
                });
              }
              continue;
            }
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
          if (fromEmail && fromEmail.toLowerCase() === token.email.toLowerCase()) {
            await logIngest(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromAddress: fromEmail,
              subject,
              disposition: "skipped_self",
            });
            continue;
          }

          const { text, html } = extractBody(msg.payload);
          const attachmentsMeta = extractAttachments(msg.payload);

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
            attachments: attachmentsMeta,
          });

          if (replyResult.matched) {
            await logIngest(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromAddress: fromEmail,
              subject,
              disposition: "routed_as_reply",
              detail: { via: "thread_match" },
            });
            dispatched += 1;
            continue; // skip lead-intake — this was a reply
          }

          // ── Second try: AI intent classifier ──
          // Replaces the rule-based "filename regex" detection with an LLM
          // call (Haiku) that reads the email holistically — subject + body
          // + sender + attachment filenames — and decides what bucket it
          // belongs to. Result drives routing.
          //
          // We still run a rule-based pre-check as a SAFETY NET: if the
          // filename obviously matches a CREXi report (cheap regex), we
          // can skip the AI call and route directly. The AI handles
          // everything else (forwarded files, new naming conventions,
          // direct inquiries, unsubscribes, spam, etc.).
          const obviousCrexiReport =
            hasLeadReportXlsx(msg.payload) ||
            hasLeadReportCsv(msg.payload) ||
            looksLikeLeadReportEmail(subject, msg.payload);

          let classification: InboundClassification | null = null;
          let routedAs: string = obviousCrexiReport ? "crexi_report (rule)" : "";

          if (obviousCrexiReport) {
            // Skip the AI call — rules are confident this is a CREXi report
            classification = {
              intent: "crexi_report",
              confidence: 1.0,
              reasoning: "Matched rule-based filename / subject pattern",
              classifiedAt: new Date().toISOString(),
              model: "rule",
            };
          } else {
            classification = await classifyInboundEmail({
              fromAddress: fromEmail,
              subject: subject ?? null,
              bodyPreview: text ?? "",
              attachmentFilenames: collectAttachmentFilenames(msg.payload),
            });
            routedAs = `${classification.intent} (ai, conf=${classification.confidence.toFixed(2)})`;
          }
          console.log(`[poll-gmail] ${msg.id} from=${fromEmail ?? "?"} → ${routedAs}: ${classification.reasoning}`);

          // ── Route based on classification ──
          if (classification.intent === "crexi_report") {
            // ALWAYS dispatch and continue — never fall through to lead-intake.
            // Why: Netlify function-to-function fetches sometimes return
            // non-ok status even when the target function completes
            // successfully (cold-start timing, internal proxy quirks).
            // Falling through on reportRes.ok=false caused BOTH the parser
            // AND the auto-ack to run for forwarded CREXi reports. The
            // parser writes its own status to import_jobs — that's the
            // authoritative audit trail. If the parse fails, the broker
            // can re-trigger manually rather than getting embarrassing
            // auto-acks fired in the meantime.
            try {
              const reportRes = await fetch(`${origin}/api/leads/crexi-report`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ gmail_message_id: msg.id }),
              });
              const ok = reportRes.ok;
              const status = reportRes.status;
              const bodyText = await reportRes.text().catch(() => "");
              console.log(`[poll-gmail] crexi-report dispatch for ${msg.id}: ok=${ok} status=${status} body=${bodyText.slice(0, 200)}`);
            } catch (err) {
              console.error(`[poll-gmail] CREXi report dispatch error (parser may still run):`, err);
            }
            await logIngest(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromAddress: fromEmail,
              subject,
              disposition: "crexi_report",
              detail: { routedAs, attachments: attachmentsMeta.map((a) => a.filename) },
            });
            dispatched += 1;
            continue; // unconditionally skip lead-intake on crexi_report classification
          }

          // Drop these without auto-acking — they don't deserve a response
          if (classification.intent === "spam" || classification.intent === "internal") {
            console.log(`[poll-gmail] ${msg.id} dropped (${classification.intent}) — no auto-ack`);
            await logIngest(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromAddress: fromEmail,
              subject,
              disposition: "dropped_by_classifier",
              detail: { intent: classification.intent, reasoning: classification.reasoning },
            });
            dispatched += 1;
            continue;
          }

          // Unsubscribe — record the opt-out and don't reply.
          if (classification.intent === "unsubscribe" && fromEmail) {
            await supabase.from("email_optouts").upsert({
              organization_id: ORG_ID,
              email: fromEmail.toLowerCase().trim(),
              source: "reply_unsubscribe",
              reason: `Auto-detected unsubscribe via classifier: ${classification.reasoning}`,
            }, { onConflict: "organization_id,email" }).select();
            console.log(`[poll-gmail] ${msg.id} unsubscribed ${fromEmail}`);
            await logIngest(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromAddress: fromEmail,
              subject,
              disposition: "unsubscribe",
            });
            dispatched += 1;
            continue;
          }

          // data_feed — placeholder route (logged + handled like generic
          // direct_inquiry for now). Future: dedicated parsers for LoopNet,
          // Buildout, CoStar exports.
          if (classification.intent === "data_feed") {
            console.log(`[poll-gmail] ${msg.id} flagged as data_feed — no parser yet, routing to lead intake`);
          }

          // cadence_reply but thread-id matching failed (new thread, forwarded,
          // contact replied from different client). Try email-based fallback:
          // find the most recent outbound we sent to this address and route as reply.
          if (classification.intent === "cadence_reply" && fromEmail) {
            const emailFallback = await routeAsReplyByEmail(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromEmail,
              fromName,
              subject,
              bodyText: text || "",
              receivedAt: new Date().toISOString(),
              attachments: attachmentsMeta,
            });
            if (emailFallback.matched) {
              console.log(`[poll-gmail] ${msg.id} cadence_reply matched via email fallback (fromEmail=${fromEmail})`);
              await logIngest(supabase, {
                gmailMessageId: msg.id,
                gmailThreadId: msg.threadId,
                fromAddress: fromEmail,
                subject,
                disposition: "routed_as_reply",
                detail: { via: "email_fallback" },
              });
              dispatched += 1;
              continue;
            }
            console.log(`[poll-gmail] ${msg.id} cadence_reply: no email match either — falling through to lead intake`);
          }

          const intakePayload = {
            source: "email",
            sender_name: fromName,
            sender_email: fromEmail,
            sender_phone: null,
            raw_subject: subject,
            raw_body: text,
            source_message_id: msg.id,
            attachments: attachmentsMeta,
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
          if (intakeRes.ok) {
            dispatched += 1;
            await logIngest(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromAddress: fromEmail,
              subject,
              disposition: "lead_intake",
              detail: { intent: classification.intent },
            });
          } else {
            // Intake said no (e.g. CREXi lead without an email, validation
            // failure). Record it — a rejected intake with no audit row was
            // one of the silent-drop paths this log exists to eliminate.
            const rejBody = await intakeRes.text().catch(() => "");
            await logIngest(supabase, {
              gmailMessageId: msg.id,
              gmailThreadId: msg.threadId,
              fromAddress: fromEmail,
              subject,
              disposition: "intake_rejected",
              detail: { status: intakeRes.status, body: rejBody.slice(0, 300) },
            });
          }
        } catch (err) {
          // Log but keep going — single message failure shouldn't break the loop
          console.error(`[poll-gmail] failed to ingest message ${msgRef.id}:`, err);
          await logIngest(supabase, {
            gmailMessageId: msgRef.id,
            disposition: "error",
            detail: { message: err instanceof Error ? err.message : String(err) },
          });
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

  // ── Job 3: Sync Gmail SENT → CRM leads ──────────────────────────────────
  // Catches emails John sent directly from Gmail (not via the CRM send button)
  // so the action queue doesn't keep surfacing leads he already contacted.
  //
  // Runs on EVERY connected mailbox — inquiries@ AND john@ once connected —
  // because John replies to leads from his own address. Inbound polling
  // (Job 1) deliberately stays on the primary mailbox only: the intake
  // pipeline auto-acks new senders, which must never happen to someone
  // emailing john@ directly.
  //
  // Searches the last 21 days of SENT mail, 50 messages per account per run
  // (dedup by external_id means repeated runs quickly skip already-processed
  // messages).
  const syncAccounts = await getActiveGmailTokens(supabase);
  const ourEmails = new Set(syncAccounts.map((t) => t.email.toLowerCase()));

  for (const acct of syncAccounts) {
    try {
      const cutoff = new Date(Date.now() - 21 * 24 * 3600_000);
      const afterStr = `${cutoff.getFullYear()}/${String(cutoff.getMonth() + 1).padStart(2, "0")}/${String(cutoff.getDate()).padStart(2, "0")}`;
      // 50/run (was 20): a busy send day plus the every-minute cron means the
      // backlog clears within the hour instead of risking messages aging out
      // of the 21-day window before they're ever scanned. Historical gaps
      // beyond the window are the coverage backfill's job.
      const sentRefs = await listMessages(acct.accessToken, `in:sent after:${afterStr}`, 50);

      let synced = 0;
      let skipped = 0;

      for (const ref of sentRefs) {
        try {
          // Fast dedup: orphaned comms (lead_id=null) are now healed at lead-
          // creation time via linkOrphanedComms in intake + crexi-report.
          // This job only needs to catch emails John sends directly from Gmail
          // (outside the CRM) — those will never appear in communications at all.
          // NOTE: .limit(1) is load-bearing. Without it, .maybeSingle() throws
          // once >1 row already shares this external_id — which flips the guard
          // to "not logged" and inserts YET another dupe. Concurrent polls
          // (this cron fires every minute) had raced past the check and seeded
          // duplicates, and the erroring guard then snowballed them. Capping at
          // one row makes the existence check correct again.
          const { data: alreadyLogged } = await supabase
            .from("communications")
            .select("id")
            .eq("external_id", ref.id)
            .limit(1)
            .maybeSingle();
          if (alreadyLogged) { skipped++; continue; }

          const msg = await getMessage(acct.accessToken, ref.id);
          const toHeader = getHeader(msg.payload, "To");
          const subject = getHeader(msg.payload, "Subject");
          const { email: toEmail } = parseAddress(toHeader);

          // Skip messages without a real recipient, or sent between our own
          // mailboxes (inquiries@ ↔ john@ is internal plumbing, not a touch)
          if (!toEmail) { skipped++; continue; }
          if (ourEmails.has(toEmail.toLowerCase())) { skipped++; continue; }

          const sentAt = msg.internalDate
            ? new Date(parseInt(msg.internalDate)).toISOString()
            : new Date().toISOString();

          // Match to the most recent non-archived CRM lead for this email address
          const { data: matchedLead } = await supabase
            .from("leads")
            .select("id, property_id, contact_id, status")
            .eq("organization_id", ORG_ID)
            .ilike("sender_email", toEmail.trim())
            .not("status", "in", '("archived","spam")')
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          // No lead match is NOT a reason to drop the email. This used to
          // `continue` here, which meant anything sent from Gmail to someone
          // who wasn't already a CRM lead — a broker, an owner being courted,
          // an attorney on a deal — was never logged anywhere. That silently
          // violated the "communications is the universal message log"
          // contract. Now we always write the row and attach whatever context
          // we can find; a row with null lead_id/property_id is far better
          // than no row at all, and linkOrphanedComms heals lead_id later if
          // that person becomes a lead.
          //
          // Fall back to a direct contact lookup by recipient address so the
          // email still lands on the contact timeline even with no lead.
          let resolvedContactId = (matchedLead?.contact_id as string | null) ?? null;
          if (!resolvedContactId) {
            const { data: contactRow } = await supabase
              .from("contacts")
              .select("id")
              .eq("organization_id", ORG_ID)
              .ilike("email", toEmail.trim())
              .limit(1)
              .maybeSingle();
            resolvedContactId = (contactRow?.id as string | null) ?? null;
          }

          // Secondary mailboxes (John's personal account) carry personal
          // correspondence too. Only log sends to people the CRM already
          // knows — a matched lead or contact. The log-everything contract
          // applies to the PRIMARY (business) mailbox only.
          const isPrimary = acct.email.toLowerCase() === PRIMARY_MAILBOX;
          if (!isPrimary && !matchedLead && !resolvedContactId) {
            skipped++;
            continue;
          }

          const { text: bodyText } = extractBody(msg.payload);
          await supabase.from("communications").insert({
            organization_id: ORG_ID,
            lead_id: (matchedLead?.id as string | null) ?? null,
            // For outbound mail WE are the sender, so the counterparty is the
            // recipient — from the matched lead's contact, or the direct
            // address lookup above.
            contact_id: resolvedContactId,
            property_id: (matchedLead?.property_id as string | null) ?? null,
            channel: "email",
            direction: "outbound",
            external_id: ref.id,
            subject,
            body_preview: bodyText.slice(0, 500),
            from_address: acct.email,
            to_addresses: [toEmail],
            occurred_at: sentAt,
            // Sent by hand from Gmail, outside the CRM — that's the "manual"
            // motion regardless of whether it happened to match a lead.
            touch_kind: "manual",
            attachments: extractAttachments(msg.payload),
            raw_payload: {
              gmail_message_id: ref.id,
              gmail_thread_id: msg.threadId,
              label_ids: msg.labelIds,
              source: "gmail_sent_sync",
              mailbox: acct.email,
              matched_lead: !!matchedLead,
            },
          });

          // Feed the voice-learning loop — an email John typed himself in
          // Gmail is the purest example of his voice. Only when it went to
          // someone the CRM knows (keeps the pool business-relevant).
          if (matchedLead || resolvedContactId) {
            await captureVoiceExample(supabase, {
              channel: "email",
              subject,
              body: bodyText,
              source: "manual",
              propertyId: (matchedLead?.property_id as string | null) ?? null,
              sentAt,
            });
          }

          // Mark the lead as sent so it leaves the action queue.
          // Only meaningful when we actually matched one.
          if (matchedLead && matchedLead.status !== "sent") {
            await supabase.from("leads").update({
              status: "sent",
              final_sent_at: sentAt,
              updated_at: new Date().toISOString(),
            }).eq("id", matchedLead.id);
          }

          synced++;
        } catch (msgErr) {
          console.error(`[poll-gmail] sent-sync error on ${ref.id}:`, msgErr);
        }
      }

      result.sentSync[acct.email] = { synced, skipped };
    } catch (syncErr: any) {
      result.sentSync[acct.email] = { error: syncErr.message };
      console.error(`[poll-gmail] sent-sync failed for ${acct.email}:`, syncErr.message);
    }
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
