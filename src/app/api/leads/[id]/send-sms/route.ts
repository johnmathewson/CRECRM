/**
 * POST /api/leads/[id]/send-sms
 *
 * Sends an SMS reply to the lead's phone number via the Messaging Service
 * (A2P campaign rules apply) and threads it into `communications` so it
 * shows in the lead's conversation thread.
 *
 * Body: { body: string }
 *
 * Authenticated — middleware gates this route by default.
 * Honors TWILIO_TEST_MODE (reroutes to TWILIO_TEST_DESTINATION).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendSms, toE164 } from "@/lib/twilio";
import { captureVoiceExample } from "@/lib/cre-os/voice-examples";
import { resolveParty, recordTouch, alarm } from "@/lib/cre-os/record-touch";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Middleware excludes /api — this route enforces its own auth. Unlike the
  // Gmail send route (whose token grant is itself gated), an open SMS send
  // endpoint would let anyone with a lead UUID text from the business line.
  const authSb = createServerSupabase();
  const { data: { user } } = await authSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: string;
  try {
    const json = await req.json();
    body = String(json?.body ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: "Message body is empty" }, { status: 400 });
  }
  // 1600 chars = Twilio's max concatenated message length
  if (body.length > 1600) {
    return NextResponse.json({ error: "Message too long (1600 char max)" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: lead } = await supabase
    .from("leads")
    .select("id, sender_phone, sender_name, contact_id, property_id, status")
    .eq("organization_id", ORG_ID)
    .eq("id", params.id)
    .maybeSingle();

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  const to = toE164(lead.sender_phone);
  if (!to) {
    return NextResponse.json(
      { error: "Lead has no usable phone number" },
      { status: 400 }
    );
  }

  // Respect opt-outs recorded on the contact (Twilio blocks at carrier level
  // too, but don't even attempt).
  if (lead.contact_id) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("notes")
      .eq("id", lead.contact_id)
      .maybeSingle();
    if (contact?.notes?.includes("SMS opt-out received")) {
      return NextResponse.json(
        { error: "This contact has opted out of SMS." },
        { status: 409 }
      );
    }
  }

  let result;
  try {
    result = await sendSms({ to, body });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Twilio send failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const now = new Date().toISOString();

  // Thread into communications (the lead detail's conversation thread).
  // The text is already out the door — the record must land regardless, so
  // a lead that somehow lacks its person gets one resolved from the number.
  try {
    const contactId =
      lead.contact_id ??
      (await resolveParty(supabase, { phone: to, name: lead.sender_name, source: "send_sms" })).contactId;
    await recordTouch(supabase, {
      channel: "sms",
      direction: "outbound",
      contactId,
      leadId: lead.id,
      propertyId: lead.property_id ?? null,
      externalId: result.messageSid,
      body,
      fromAddress: process.env.TWILIO_FROM_NUMBER ?? null,
      toAddresses: [to],
      occurredAt: now,
      touchKind: "manual",
      source: "manual",
      rawPayload: {
        via: "inbox-sms-composer",
        twilio_message_sid: result.messageSid,
        twilio_status: result.status,
        test_mode_rerouted: result.rerouted,
      },
    });
  } catch (err) {
    await alarm(supabase, "sms_outbound_not_recorded", `Sent text to ${to} but could not record it: ${err instanceof Error ? err.message : String(err)}`, {
      lead_id: lead.id,
      message_sid: result.messageSid,
    });
  }

  // Feed the voice-learning loop — John's real texts teach the SMS drafts.
  // Best-effort: never blocks the send (already out the door anyway).
  await captureVoiceExample(supabase, {
    channel: "sms",
    body,
    source: "manual",
    propertyId: lead.property_id ?? null,
    sentAt: now,
  });

  // A texted reply counts as contacting the lead. Don't downgrade later
  // states (sent/archived/spam). NB: 'contacted' — the old 'acknowledged'
  // is not in leads_status_check, so that update had been failing silently.
  const status = (lead.status ?? "").toLowerCase();
  if (status === "new") {
    await supabase
      .from("leads")
      .update({ status: "contacted", updated_at: now })
      .eq("id", lead.id);
  }

  return NextResponse.json({
    ok: true,
    messageSid: result.messageSid,
    rerouted: result.rerouted,
  });
}
