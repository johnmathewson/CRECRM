/**
 * POST /api/webhooks/twilio/voice/complete
 *
 * <Dial> action callback from /voice. DialCallStatus tells us how the
 * forward leg ended:
 *
 *   completed → John answered; log duration, hang up. No inbox card, no
 *               notification — he literally just took the call.
 *   anything else (no-answer / busy / failed / canceled) → voicemail:
 *               ensure an inbox lead exists, SMS John the deeplink, then
 *               greet + <Record> with transcription.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/twilio";
import { parseTwilioWebhook, twiml, escapeXml } from "@/lib/twilio-webhook";
import {
  getCallRow,
  updateCallRow,
  findContactByPhone,
  ensureLeadForCall,
  notifyJohn,
} from "@/lib/twilio-voice";

export const dynamic = "force-dynamic";

const GREETING =
  "You've reached John Mathewson with Stewardship Commercial Real Estate. " +
  "I can't get to the phone right now — please leave your name, number, and " +
  "the property you're calling about, and I'll call you back shortly.";

export async function GET() {
  return twiml();
}

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilioWebhook(req);
  if (!valid) {
    console.warn("[twilio-voice] complete: signature invalid — dropping");
    return twiml("<Hangup/>");
  }

  const callSid = params["CallSid"] ?? null;
  const from = params["From"] ?? "";
  const dialStatus = params["DialCallStatus"] ?? "";
  const duration = params["DialCallDuration"] ?? null;
  const answered = dialStatus === "completed";
  const origin = req.nextUrl.origin;

  const voicemailTwiml =
    `<Say voice="Polly.Matthew-Neural">${escapeXml(GREETING)}</Say>` +
    `<Record action="${origin}/api/webhooks/twilio/voice/voicemail" method="POST"` +
    ` maxLength="120" timeout="6" playBeep="true"` +
    ` transcribe="true" transcribeCallback="${origin}/api/webhooks/twilio/voice/transcription"/>` +
    `<Say voice="Polly.Matthew-Neural">Didn't catch a message — feel free to text this number instead. Thanks.</Say>` +
    `<Hangup/>`;

  if (!callSid) {
    return answered ? twiml("<Hangup/>") : twiml(voicemailTwiml);
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const row = await getCallRow(supabase, callSid);

    if (answered) {
      if (row) {
        await updateCallRow(
          supabase,
          row,
          { body_preview: `Answered call${duration ? ` (${duration}s)` : ""}` },
          { status: "answered", dial_duration_seconds: duration }
        );
      }
      return twiml("<Hangup/>");
    }

    // ── Missed → ensure inbox lead + notify, then voicemail prompt ──────
    const normalizedFrom = toE164(from) ?? from;
    const contact = await findContactByPhone(supabase, normalizedFrom, from);
    const lead = await ensureLeadForCall(supabase, {
      phoneE164: normalizedFrom,
      phoneRaw: from,
      contactId: contact?.id ?? null,
      contactName: contact?.full_name ?? null,
    });

    if (row) {
      await updateCallRow(
        supabase,
        row,
        {
          body_preview: "Missed call — sent to voicemail",
          ...(lead?.id ? { lead_id: lead.id } : {}),
          ...(contact?.id ?? lead?.contact_id
            ? { contact_id: (contact?.id ?? lead?.contact_id) as string }
            : {}),
          ...(lead?.property_id ? { property_id: lead.property_id } : {}),
        },
        { status: "voicemail_prompt", dial_status: dialStatus }
      );
    }

    const who = contact?.full_name ?? normalizedFrom;
    await notifyJohn(
      lead
        ? `Missed call on the business line from ${who}. Voicemail + transcript will land here: ${origin}/cre-os/inbox/${lead.id}`
        : `Missed call on the business line from ${who}.`
    );

    return twiml(voicemailTwiml);
  } catch (err) {
    console.error(
      "[twilio-voice] complete: DB error (voicemail prompt anyway):",
      err instanceof Error ? err.message : err
    );
    return answered ? twiml("<Hangup/>") : twiml(voicemailTwiml);
  }
}
