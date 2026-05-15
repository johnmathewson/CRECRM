/**
 * POST /api/lane-touches/[id]/send-reply
 *
 * Send a reply email to an inbound lane_touch. The touch must be an
 * inbound reply (status='responded' with metadata.direction='inbound')
 * — we use the stored gmail_thread_id to keep the message in the same
 * Gmail thread, and the metadata.from_email as the recipient.
 *
 * Body:
 *   { body: string, subject?: string }   // both optional — if omitted,
 *   uses metadata.classification.suggestedReply and "Re: <subject>"
 *
 * Side effects on success:
 *   - sends via Gmail (threaded under same threadId)
 *   - writes a new lane_touches row at status='sent' (outbound reply)
 *   - writes an outbound communications row + activity entry
 *   - keeps the enrollment at status='engaged' (human now driving)
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { body?: string; subject?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load the inbound touch
  const { data: inbound, error: loadErr } = await supabase
    .from("lane_touches")
    .select("id, organization_id, enrollment_id, lane_id, property_id, contact_id, subject, body, metadata")
    .eq("organization_id", ORG_ID)
    .eq("id", params.id)
    .maybeSingle();
  if (loadErr || !inbound) return NextResponse.json({ error: "Touch not found" }, { status: 404 });

  const meta = (inbound.metadata as Record<string, unknown>) ?? {};
  if (meta.direction !== "inbound") {
    return NextResponse.json({ error: "This isn't an inbound reply" }, { status: 400 });
  }

  const threadId = meta.gmail_thread_id as string | undefined;
  const toEmail = meta.from_email as string | undefined;
  const toName = meta.from_name as string | undefined;
  if (!toEmail) {
    return NextResponse.json({ error: "No from_email on the inbound — can't determine recipient" }, { status: 400 });
  }

  // Build body — use override if provided, else the AI suggested reply
  const classification = (meta.classification ?? {}) as { suggestedReply?: string };
  const replyBody = (body.body && body.body.trim()) || classification.suggestedReply;
  if (!replyBody || !replyBody.trim()) {
    return NextResponse.json({ error: "No body provided and no AI suggested reply on file" }, { status: 400 });
  }

  // Subject: caller override, else "Re: <inbound subject>" (stripping leading Re:)
  const inboundSubject = (inbound.subject as string | null) ?? "";
  const cleanInboundSubj = inboundSubject.replace(/^(\[?[A-Z _]+\]?\s*)?(re:\s*)+/gi, "");
  const subject =
    (body.subject && body.subject.trim()) ||
    (cleanInboundSubj ? `Re: ${cleanInboundSubj}` : "Re: your message");

  // Gmail token
  const token = await getActiveGmailToken(supabase);
  if (!token) return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });

  const fromHeader = `${SEND_DISPLAY_NAME} <${token.email}>`;
  const toHeader = toName ? `"${toName}" <${toEmail}>` : toEmail;

  // Send
  let sent;
  try {
    sent = await sendMessage(token.accessToken, {
      to: toHeader,
      from: fromHeader,
      subject,
      bodyText: replyBody,
      threadId, // keeps it in the same Gmail thread
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Gmail send failed: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }

  const sentAt = new Date().toISOString();

  // Insert outbound reply touch
  const { data: outboundTouch } = await supabase
    .from("lane_touches")
    .insert({
      organization_id: ORG_ID,
      enrollment_id: inbound.enrollment_id,
      lane_id: inbound.lane_id,
      property_id: inbound.property_id,
      contact_id: inbound.contact_id,
      step_index: 0,
      channel: "email",
      status: "sent",
      sent_at: sentAt,
      subject,
      body: replyBody,
      metadata: {
        direction: "outbound",
        gmail_message_id: sent.id,
        gmail_thread_id: sent.threadId,
        parent_inbound_touch_id: inbound.id,
        used_ai_draft: !body.body, // true if we used the AI's suggestion as-is
        ai_draft_edited: !!body.body && body.body.trim() !== classification.suggestedReply?.trim(),
      },
    })
    .select("id")
    .single();

  // Log activity + outbound communications for cross-reference
  await supabase.from("activities").insert({
    organization_id: ORG_ID,
    activity_type: "email",
    subject,
    body: replyBody,
    occurred_at: sentAt,
    property_id: inbound.property_id,
    contact_id: inbound.contact_id,
  });
  await supabase.from("communications").insert({
    organization_id: ORG_ID,
    property_id: inbound.property_id,
    channel: "email",
    direction: "outbound",
    external_id: sent.id,
    subject,
    body_preview: replyBody.slice(0, 500),
    from_address: token.email,
    to_addresses: [toEmail],
    occurred_at: sentAt,
    raw_payload: {
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      source: "send-suggested-reply",
      parent_inbound_touch_id: inbound.id,
    },
  });

  // Capture as a voice example. "ai_edited" if the broker changed the AI
  // draft, "ai_drafted" if they sent the AI's suggestion as-is.
  const aiDraft = classification.suggestedReply ?? "";
  const wasEdited = !!body.body && body.body.trim() !== aiDraft.trim();
  await captureVoiceExample(supabase, {
    channel: "email",
    subject,
    body: replyBody,
    source: wasEdited ? "ai_edited" : "ai_drafted",
    userEditsDiff: wasEdited ? `AI draft was:\n${aiDraft}\n\nBroker sent:\n${replyBody}` : null,
    // Reply persona — distinct from outbound. For now, slug-match to the
    // intent if available, else fall back to listing_inquiry_followup (most
    // common case for our current listings).
    personaSlug: "listing_inquiry_followup",
    propertyId: inbound.property_id,
    recipientEngagement: "Replied to outbound",
    recipientProfileSnapshot: {
      from_email: toEmail,
      from_name: toName,
    },
    sentAt,
  });

  return NextResponse.json({
    ok: true,
    sent_at: sentAt,
    gmail_message_id: sent.id,
    gmail_thread_id: sent.threadId,
    lane_touch_id: outboundTouch?.id,
  });
}
