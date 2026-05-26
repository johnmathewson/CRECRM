/**
 * POST /api/leads/[id]/send
 *
 * Sends the lead's current draft (or an override body in the request) via
 * Gmail. Threads the reply to the original inbound message_id when present.
 *
 * Request body (optional):
 *   { body?: string, subject?: string, to?: string }
 * Defaults: lead.draft_reply, "Re: <raw_subject>", lead.sender_email.
 *
 * Side effects on success:
 *   - leads: final_reply, final_sent_at, status='sent'
 *   - communications: outbound row, threaded under same lead_id
 *   - lead_events: 'sent' event with the gmail message id in metadata
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { sendMessage } from "@/lib/gmail";
import { captureVoiceExample } from "@/lib/cre-os/voice-examples";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const SEND_DISPLAY_NAME = "John Mathewson";

interface SendBody {
  body?: string;
  subject?: string;
  to?: string;
}

/**
 * Minimal word-level diff for voice-example capture. Returns a compact
 * human-readable string showing what John changed from the AI draft so
 * future prompts can learn his editing patterns.
 *
 * We don't pull in a full diff library here — this is best-effort context
 * for the few-shot retriever, not a strict patch format.
 */
function computeDiff(original: string, edited: string): string {
  const origLines = original.split("\n");
  const editLines = edited.split("\n");
  const removed = origLines.filter((l) => !editLines.includes(l)).map((l) => `- ${l}`);
  const added = editLines.filter((l) => !origLines.includes(l)).map((l) => `+ ${l}`);
  if (!removed.length && !added.length) return "(no line-level changes)";
  return [...removed.slice(0, 20), ...added.slice(0, 20)].join("\n");
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let override: SendBody = {};
  try {
    if (req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0) {
      override = await req.json();
    }
  } catch {
    // empty body is fine
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Load lead + inbound thread ──
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select(`
      id, status, sender_email, sender_name, raw_subject, draft_reply,
      property_id, source, qualifier_summary,
      organization_id
    `)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (leadErr || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const to = override.to || lead.sender_email;
  if (!to) {
    return NextResponse.json(
      { error: "No recipient email on this lead" },
      { status: 400 }
    );
  }

  const bodyText = override.body || lead.draft_reply;
  if (!bodyText || !bodyText.trim()) {
    return NextResponse.json(
      { error: "Draft is empty — write a body before sending" },
      { status: 400 }
    );
  }

  const subject =
    override.subject ||
    (lead.raw_subject
      ? lead.raw_subject.toLowerCase().startsWith("re:")
        ? lead.raw_subject
        : `Re: ${lead.raw_subject}`
      : "Following up on your inquiry");

  // ── Pull thread context for in-reply-to / references / threadId ──
  const { data: inboundComm } = await supabase
    .from("communications")
    .select("external_id, raw_payload")
    .eq("lead_id", lead.id)
    .eq("direction", "inbound")
    .order("occurred_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const inboundRfcMessageId =
    (inboundComm?.raw_payload as any)?.headers?.["Message-ID"] ||
    (inboundComm?.raw_payload as any)?.headers?.["message-id"] ||
    null;
  const inboundGmailThreadId = (inboundComm?.raw_payload as any)?.threadId || null;

  // ── Gmail token ──
  let token;
  try {
    token = await getActiveGmailToken(supabase);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Gmail token refresh failed: ${err.message}. Re-connect at /settings/integrations.` },
      { status: 500 }
    );
  }
  if (!token) {
    return NextResponse.json(
      { error: "Gmail not connected. Set up at /settings/integrations." },
      { status: 412 }
    );
  }

  const fromHeader = `${SEND_DISPLAY_NAME} <${token.email}>`;

  // ── Send ──
  let sent;
  try {
    sent = await sendMessage(token.accessToken, {
      to,
      from: fromHeader,
      subject,
      bodyText,
      inReplyTo: inboundRfcMessageId || undefined,
      references: inboundRfcMessageId || undefined,
      threadId: inboundGmailThreadId || undefined,
    });
  } catch (err: any) {
    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      event_type: "error",
      actor: "user",
      summary: `Send failed: ${err.message}`,
      metadata: { stage: "send", to, subject },
    });
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  // ── Persist post-send state ──
  const sentAt = new Date().toISOString();
  await supabase
    .from("leads")
    .update({
      final_reply: bodyText,
      final_sent_at: sentAt,
      status: "sent",
      updated_at: sentAt,
    })
    .eq("id", lead.id);

  await supabase.from("communications").insert({
    organization_id: ORG_ID,
    lead_id: lead.id,
    // property_id is required by match-reply-to-touch so inbound replies can
    // be threaded back to this lead instead of creating a duplicate new lead.
    property_id: (lead.property_id as string | null) ?? null,
    channel: "email",
    direction: "outbound",
    external_id: sent.id,
    subject,
    body_preview: bodyText.slice(0, 500),
    from_address: token.email,
    to_addresses: [to],
    occurred_at: sentAt,
    raw_payload: { gmail_message_id: sent.id, gmail_thread_id: sent.threadId, label_ids: sent.labelIds },
  });

  await supabase.from("lead_events").insert({
    organization_id: ORG_ID,
    lead_id: lead.id,
    event_type: "sent",
    actor: "user",
    summary: `John sent reply to ${to}`,
    metadata: { gmail_message_id: sent.id, gmail_thread_id: sent.threadId, char_count: bodyText.length },
  });

  // ── Capture voice example for future AI drafts ──
  // Best-effort: never block the 200 response if this fails.
  try {
    const aiDraft = (lead.draft_reply as string | null) ?? null;
    const wasEdited = !!aiDraft && bodyText.trim() !== aiDraft.trim();
    await captureVoiceExample(supabase, {
      channel: "email",
      subject,
      body: bodyText,
      source: aiDraft ? (wasEdited ? "ai_edited" : "ai_drafted") : "manual",
      userEditsDiff: wasEdited ? computeDiff(aiDraft!, bodyText) : null,
      // CREXi leads are always listing_inquiry_followup; inbound replies are
      // a first-touch persona. Either way the example improves future drafts.
      personaSlug:
        (lead.source as string | null) === "crexi"
          ? "listing_inquiry_followup"
          : "first_touch_reply",
      propertyId: (lead.property_id as string | null) ?? null,
      recipientEngagement: (lead.qualifier_summary as string | null) ?? null,
      recipientProfileSnapshot: {
        name: lead.sender_name ?? null,
        email: to,
        source: lead.source ?? null,
      },
      sentAt,
    });
  } catch (captureErr) {
    // Log but never fail the send
    console.warn("[send] captureVoiceExample failed:", captureErr);
  }

  return NextResponse.json({
    ok: true,
    sent_at: sentAt,
    gmail_message_id: sent.id,
    gmail_thread_id: sent.threadId,
  });
}
