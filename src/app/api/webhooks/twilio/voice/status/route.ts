/**
 * POST /api/webhooks/twilio/voice/status
 *
 * Number-level status callback — fires when the parent call ends, after
 * every other webhook. Its one job is catching the case the Dial action
 * never sees: the caller hangs up while the forward leg is still ringing
 * (TwiML execution stops, /voice/complete never fires). Those are the
 * hottest missed calls — someone dialed and bailed — so they get a lead
 * and a notification too.
 *
 * State machine (raw_payload.status at call end):
 *   'ringing'          → caller hung up during ring: mark missed, ensure
 *                        lead, notify John
 *   'voicemail_prompt' → hung up during greeting, left no message: mark it
 *                        (lead + notify already happened in /complete)
 *   anything else      → flow finished normally; no-op
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/twilio";
import { parseTwilioWebhook } from "@/lib/twilio-webhook";
import {
  getCallRow,
  updateCallRow,
  findContactByPhone,
  ensureLeadForCall,
  notifyJohn,
} from "@/lib/twilio-voice";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilioWebhook(req);
  if (!valid) {
    console.warn("[twilio-voice] status: signature invalid — dropping");
    return NextResponse.json({ ok: true });
  }

  const callSid = params["CallSid"] ?? null;
  const callStatus = params["CallStatus"] ?? "";
  const from = params["From"] ?? "";

  // Only care about terminal states of the inbound (parent) call.
  if (!callSid || !["completed", "no-answer", "busy", "failed", "canceled"].includes(callStatus)) {
    return NextResponse.json({ ok: true });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const row = await getCallRow(supabase, callSid);
    if (!row) {
      return NextResponse.json({ ok: true });
    }

    const stage = String(row.raw_payload?.status ?? "");

    if (stage === "ringing") {
      const normalizedFrom = toE164(from) ?? from;
      const contact = await findContactByPhone(supabase, normalizedFrom, from);
      const lead = await ensureLeadForCall(supabase, {
        phoneE164: normalizedFrom,
        phoneRaw: from,
        contactId: contact?.id ?? null,
        contactName: contact?.full_name ?? null,
      });

      await updateCallRow(
        supabase,
        row,
        {
          body_preview: "Missed call — caller hung up while ringing",
          ...(lead?.id ? { lead_id: lead.id } : {}),
          ...(contact?.id ?? lead?.contact_id
            ? { contact_id: (contact?.id ?? lead?.contact_id) as string }
            : {}),
          ...(lead?.property_id ? { property_id: lead.property_id } : {}),
        },
        { status: "hung_up_ringing", call_status: callStatus }
      );

      const who = contact?.full_name ?? normalizedFrom;
      const origin = req.nextUrl.origin;
      await notifyJohn(
        lead
          ? `${who} called the business line and hung up before it connected — worth a callback. ${origin}/cre-os/inbox/${lead.id}`
          : `${who} called the business line and hung up before it connected.`
      );
    } else if (stage === "voicemail_prompt") {
      await updateCallRow(
        supabase,
        row,
        { body_preview: "Missed call — no voicemail left" },
        { status: "no_voicemail", call_status: callStatus }
      );
    }
  } catch (err) {
    console.error(
      "[twilio-voice] status: DB error:",
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({ ok: true });
}
