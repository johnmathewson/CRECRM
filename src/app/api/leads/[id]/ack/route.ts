/**
 * POST /api/leads/[id]/ack
 *
 * Sends the locked 60-sec auto-acknowledgment for this lead. Called from
 * the polling cron once the scheduled_acks row's send_after time arrives.
 *
 * The acknowledgment text is interpolated from a fixed template — no LLM
 * involvement, no chance of hallucination on a message we send unattended.
 *
 * Side effects mirror /send: outbound communication, lead event, leads
 * row gets auto_ack_sent_at stamped.
 *
 * Auth: requires either x-cron-secret header (called from the cron) or a
 * valid in-app session — but since middleware doesn't gate /api/* and the
 * cron is the only legit caller, we rely on x-cron-secret for now.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { sendCrmEmail } from "@/lib/cre-os/send-crm-email";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const SEND_DISPLAY_NAME = "John Mathewson";

function firstName(full: string | null): string {
  if (!full) return "there";
  const trimmed = full.trim().split(/\s+/)[0];
  return trimmed && /^[A-Za-z]/.test(trimmed) ? trimmed : "there";
}

function buildAckBody(senderName: string | null, propertyLabel: string): string {
  // Locked per the sales-agent blueprint. Do not embellish.
  const name = firstName(senderName);
  return `Hey ${name} — got your inquiry on ${propertyLabel}. I'm running between meetings right now but will follow up personally within the hour.

— John`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Cron auth
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  if (cronSecret && provided !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: lead } = await supabase
    .from("leads")
    .select(`
      id, sender_email, sender_name, raw_subject, auto_ack_sent_at, status,
      property_id, contact_id,
      property:properties(name, headline)
    `)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (lead.auto_ack_sent_at) {
    return NextResponse.json({ ok: true, already_sent: true });
  }
  if (!lead.sender_email) {
    return NextResponse.json({ error: "No recipient email" }, { status: 400 });
  }
  if (lead.status === "spam" || lead.status === "archived") {
    return NextResponse.json({ ok: true, skipped: lead.status });
  }

  const property = (lead as any).property;
  const propertyLabel = property?.headline || property?.name || "your inquiry";
  const body = buildAckBody(lead.sender_name, propertyLabel);
  const subject = lead.raw_subject
    ? lead.raw_subject.toLowerCase().startsWith("re:") ? lead.raw_subject : `Re: ${lead.raw_subject}`
    : "Got your inquiry";

  // Pull threading info if available
  const { data: inboundComm } = await supabase
    .from("communications")
    .select("raw_payload")
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

  let token;
  try {
    token = await getActiveGmailToken(supabase);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Gmail token refresh failed: ${err.message}` },
      { status: 500 }
    );
  }
  if (!token) {
    return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
  }

  let gmailMessageId: string;
  let gmailThreadId: string;
  let sentAt: string;
  try {
    ({ gmailMessageId, gmailThreadId, sentAt } = await sendCrmEmail(
      supabase,
      token.accessToken,
      {
        to: lead.sender_email,
        from: `${SEND_DISPLAY_NAME} <${token.email}>`,
        subject,
        bodyText: body,
        inReplyTo: inboundRfcMessageId || undefined,
        references: inboundRfcMessageId || undefined,
        threadId: inboundGmailThreadId || undefined,
        leadId: lead.id,
        propertyId: (lead.property_id as string | null) ?? null,
        contactId: (lead.contact_id as string | null) ?? null,
        source: "ack",
        // ack does NOT flip lead to 'sent' — it stamps auto_ack_sent_at below
        updateLeadStatus: false,
        rawPayloadExtra: { kind: "auto_ack" },
      }
    ));
  } catch (err: any) {
    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      event_type: "error",
      actor: "agent",
      summary: `Auto-ack send failed: ${err.message}`,
      metadata: { stage: "auto_ack" },
    });
    throw err;
  }

  // Stamp auto_ack_sent_at — distinct from final_sent_at / status='sent'
  await supabase
    .from("leads")
    .update({ auto_ack_sent_at: sentAt, updated_at: sentAt })
    .eq("id", lead.id);

  await supabase.from("lead_events").insert({
    organization_id: ORG_ID,
    lead_id: lead.id,
    event_type: "sent",
    actor: "agent",
    summary: `Auto-ack sent to ${lead.sender_email}`,
    metadata: { gmail_message_id: gmailMessageId, kind: "auto_ack", property_label: propertyLabel },
  });

  return NextResponse.json({ ok: true, sent_at: sentAt, gmail_message_id: gmailMessageId });
}
