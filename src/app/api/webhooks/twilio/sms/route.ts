/**
 * POST /api/webhooks/twilio/sms
 *
 * Twilio inbound SMS handler. Configure this URL in the Twilio console
 * for the Messaging Service's "When a message comes in" hook.
 *
 * Three flows:
 *   1. STOP / UNSUBSCRIBE / CANCEL — log opt-out on the contact, halt
 *      any active lane enrollments for them. Twilio auto-blocks the
 *      number from further outbound at the carrier level too.
 *   2. HELP — auto-reply with our brand + opt-out info (compliance).
 *   3. Reply — match the inbound to a recent outbound SMS lane_touch
 *      (by phone number), log as inbound, flip enrollment to engaged.
 *
 * Always returns TwiML — either empty or a Response with a single Message
 * for the HELP auto-reply.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyTwilioSignature, classifyInboundSms, toE164 } from "@/lib/twilio";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BRAND_NAME = "Stewardship CRE";

function twiml(messageBody?: string): NextResponse {
  const body = messageBody
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(messageBody)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: NextRequest) {
  // Twilio sends form-encoded body
  const formData = await req.formData();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: Record<string, string> = {};
  formData.forEach((v, k) => { params[k] = String(v); });

  const from = params["From"] ?? null;
  const to = params["To"] ?? null;
  const body = params["Body"] ?? "";
  const messageSid = params["MessageSid"] ?? null;

  // Verify signature (defensive against spoofed inbound). On signature
  // failure we still 200 OK to Twilio but log + drop the message.
  const sigValid = verifyTwilioSignature({
    signature: req.headers.get("x-twilio-signature"),
    url: `${req.nextUrl.origin}${req.nextUrl.pathname}`,
    params,
  });
  if (!sigValid) {
    console.warn("[twilio-webhook] signature invalid — dropping inbound", { from, messageSid });
    return twiml(); // still 200 so Twilio doesn't retry
  }

  if (!from || !messageSid) {
    return twiml();
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const intent = classifyInboundSms(body);
  const normalizedFrom = toE164(from) ?? from;
  const receivedAt = new Date().toISOString();

  // ── 1. Handle STOP ───────────────────────────────────────────────────
  if (intent === "stop") {
    // Find contact by phone
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, full_name")
      .eq("organization_id", ORG_ID)
      .or(`phone.eq.${normalizedFrom},phone.eq.${from}`)
      .maybeSingle();

    if (contact) {
      // Append a note about opt-out (cleanest schema-wise without a new column)
      await supabase
        .from("contacts")
        .update({
          notes: ((await supabase.from("contacts").select("notes").eq("id", contact.id).maybeSingle()).data?.notes ?? "") +
            `\n\n[${receivedAt}] SMS opt-out received. No further SMS allowed.`,
          warmth: "cold",
          updated_at: receivedAt,
        })
        .eq("id", contact.id);

      // Halt any active enrollments
      await supabase
        .from("lane_enrollments")
        .update({
          status: "exited_dnc",
          exited_at: receivedAt,
          exit_reason: "SMS opt-out (STOP)",
        })
        .eq("organization_id", ORG_ID)
        .in("status", ["active", "engaged", "paused"])
        .in("property_id",
          (await supabase
            .from("activities")
            .select("property_id")
            .eq("organization_id", ORG_ID)
            .eq("contact_id", contact.id)
            .not("property_id", "is", null)
          ).data?.map((a) => a.property_id) ?? []
        );
    }

    // Twilio auto-responds with the carrier opt-out message; we return empty.
    return twiml();
  }

  // ── 2. Handle HELP ───────────────────────────────────────────────────
  if (intent === "help") {
    return twiml(
      `${BRAND_NAME} — John Mathewson, broker. ` +
      `Reply STOP to opt out. Questions: john@stewardshipcre.com`
    );
  }

  // ── 3. START (re-opt-in) ─────────────────────────────────────────────
  if (intent === "start") {
    // Carrier handles the actual opt-in; we just acknowledge.
    return twiml(`${BRAND_NAME}: You're back in. Reply STOP at any time.`);
  }

  // ── 4. Reply to a sent SMS touch ─────────────────────────────────────
  // Find the most recent SMS touch we sent to this phone number.
  const { data: parentTouches } = await supabase
    .from("lane_touches")
    .select("id, enrollment_id, lane_id, property_id, contact_id, metadata")
    .eq("organization_id", ORG_ID)
    .eq("channel", "sms")
    .eq("status", "sent")
    .filter("metadata->>to_phone", "in", `(${normalizedFrom},${from})`)
    .order("sent_at", { ascending: false })
    .limit(1);

  const parent = (parentTouches ?? [])[0];

  if (parent) {
    // Insert inbound reply touch
    await supabase.from("lane_touches").insert({
      organization_id: ORG_ID,
      enrollment_id: parent.enrollment_id,
      lane_id: parent.lane_id,
      property_id: parent.property_id,
      contact_id: parent.contact_id,
      step_index: 0,
      channel: "sms",
      status: "responded",
      responded_at: receivedAt,
      subject: null,
      body,
      metadata: {
        direction: "inbound",
        twilio_message_sid: messageSid,
        from_phone: normalizedFrom,
        parent_touch_id: parent.id,
      },
    });

    // Flip parent + enrollment
    await supabase.from("lane_touches").update({
      responded_at: receivedAt, status: "responded",
    }).eq("id", parent.id);

    if (parent.enrollment_id) {
      await supabase.from("lane_enrollments").update({
        status: "engaged",
        exit_reason: `SMS reply from ${normalizedFrom}`,
      })
        .eq("organization_id", ORG_ID)
        .eq("id", parent.enrollment_id)
        .in("status", ["active", "paused"]);
    }

    // Activity entry on the property timeline
    await supabase.from("activities").insert({
      organization_id: ORG_ID,
      activity_type: "text",
      subject: `SMS reply from ${normalizedFrom}`,
      body,
      occurred_at: receivedAt,
      property_id: parent.property_id,
      contact_id: parent.contact_id,
    });
  } else {
    // No matching outbound. Log as a standalone inbound for review —
    // future improvement: route into the regular lead-intake pipeline.
    await supabase.from("activities").insert({
      organization_id: ORG_ID,
      activity_type: "text",
      subject: `Unmatched SMS from ${normalizedFrom}`,
      body,
      occurred_at: receivedAt,
    });
  }

  return twiml();
}
