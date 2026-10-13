/**
 * POST /api/webhooks/twilio/voice
 *
 * Inbound call on the business line (+1 317-804-1980). Configure as the
 * number's "A call comes in" webhook — /api/integrations/twilio/voice-setup
 * does this via the Twilio API.
 *
 * Mirrors the call into `communications` up front (one row per call, keyed
 * on CallSid), then <Dial>s John's cell with caller-ID passthrough. The
 * Dial action → /voice/complete decides answered vs voicemail.
 *
 * DB work is best-effort: a Supabase hiccup must never keep the phone from
 * ringing, so the TwiML always goes out.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/twilio";
import { parseTwilioWebhook, twiml, escapeXml } from "@/lib/twilio-webhook";
import { ORG_ID, forwardToNumber, resolveCaller } from "@/lib/twilio-voice";
import { recordTouch, alarm } from "@/lib/cre-os/record-touch";

export const dynamic = "force-dynamic";

/** Twilio's console URL validator GETs the webhook when saved. */
export async function GET() {
  return twiml();
}

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilioWebhook(req);
  if (!valid) {
    console.warn("[twilio-voice] signature invalid — rejecting call", {
      from: params["From"],
      callSid: params["CallSid"],
    });
    return twiml("<Reject/>");
  }

  const from = params["From"] ?? null;
  const callSid = params["CallSid"] ?? null;
  if (!from || !callSid) {
    return twiml("<Hangup/>");
  }

  const normalizedFrom = toE164(from) ?? from;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Idempotency — Twilio retries on slow responses; one row per CallSid.
    const { data: already } = await supabase
      .from("communications")
      .select("id")
      .eq("external_id", callSid)
      .maybeSingle();

    if (!already) {
      // Every call has a person behind it — a new number becomes a contact.
      const contact = await resolveCaller(supabase, normalizedFrom);

      // Thread continuation: attach to an open lead for this phone if one
      // exists. Lead CREATION waits for the missed-call branch — an answered
      // call from a stranger doesn't need an inbox card, John just took it.
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: openLeads } = await supabase
        .from("leads")
        .select("id, contact_id, property_id")
        .eq("organization_id", ORG_ID)
        .or(`sender_phone.eq.${normalizedFrom},sender_phone.eq.${from}`)
        .not("status", "in", '("archived","spam")')
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1);
      const lead = (openLeads ?? [])[0] ?? null;

      await recordTouch(supabase, {
        channel: "phone",
        direction: "inbound",
        contactId: contact.id,
        leadId: lead?.id ?? null,
        propertyId: lead?.property_id ?? null,
        externalId: callSid,
        subject: `Call from ${contact.full_name ?? normalizedFrom}`,
        body: "Incoming call — ringing",
        fromAddress: normalizedFrom,
        source: "twilio_voice",
        rawPayload: { call_sid: callSid, to_phone: params["To"] ?? null, status: "ringing" },
      });
    }
  } catch (err) {
    // The phone must still ring — but a call that never reached the record
    // is exactly what John asked never to happen silently.
    await alarm(
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!),
      "call_inbound_not_recorded",
      `Call from ${normalizedFrom} could not be recorded: ${err instanceof Error ? err.message : String(err)}`,
      { call_sid: callSid }
    );
  }

  // Recording disclosure BEFORE the dial — Illinois (and other all-party
  // consent states) callers are routine here; continuing after the notice
  // is implied consent everywhere. Do not remove the <Say> while the
  // record attribute is on.
  const origin = req.nextUrl.origin;
  return twiml(
    `<Say voice="Polly.Matthew-Neural">This call may be recorded for quality purposes.</Say>` +
      `<Dial action="${origin}/api/webhooks/twilio/voice/complete" method="POST" timeout="20" answerOnBridge="true"` +
      ` record="record-from-answer-dual"` +
      ` recordingStatusCallback="${origin}/api/webhooks/twilio/voice/recording"` +
      ` recordingStatusCallbackMethod="POST">` +
      `<Number>${escapeXml(forwardToNumber())}</Number>` +
      `</Dial>`
  );
}
