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
  await supabase.from("communications").insert({
    organization_id: ORG_ID,
    channel: "sms",
    direction: "outbound",
    external_id: result.messageSid,
    subject: null,
    body_preview: body,
    from_address: process.env.TWILIO_FROM_NUMBER ?? null,
    to_addresses: [to],
    occurred_at: now,
    lead_id: lead.id,
    contact_id: lead.contact_id ?? null,
    property_id: lead.property_id ?? null,
    touch_kind: "manual",
    raw_payload: {
      source: "manual",
      via: "inbox-sms-composer",
      twilio_message_sid: result.messageSid,
      twilio_status: result.status,
      test_mode_rerouted: result.rerouted,
    },
  });

  // A texted reply counts as acknowledging the lead. Don't downgrade
  // later states (sent/archived/spam).
  const status = (lead.status ?? "").toLowerCase();
  if (status === "new") {
    await supabase
      .from("leads")
      .update({ status: "acknowledged", updated_at: now })
      .eq("id", lead.id);
  }

  return NextResponse.json({
    ok: true,
    messageSid: result.messageSid,
    rerouted: result.rerouted,
  });
}
