/**
 * POST /api/webhooks/twilio/voice/voicemail
 *
 * <Record> action callback — fires when the voicemail recording ends
 * (including caller hangup mid-message). Stamps the recording onto the
 * call's mirror row; the transcript arrives separately at /transcription
 * a minute or so later.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseTwilioWebhook, twiml } from "@/lib/twilio-webhook";
import { getCallRow, updateCallRow } from "@/lib/twilio-voice";

export const dynamic = "force-dynamic";

export async function GET() {
  return twiml();
}

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilioWebhook(req);
  if (!valid) {
    console.warn("[twilio-voice] voicemail: signature invalid — dropping");
    return twiml("<Hangup/>");
  }

  const callSid = params["CallSid"] ?? null;
  const recordingUrl = params["RecordingUrl"] ?? null;
  const recordingSid = params["RecordingSid"] ?? null;
  const recordingDuration = params["RecordingDuration"] ?? null;

  if (callSid) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const row = await getCallRow(supabase, callSid);
      if (row) {
        await updateCallRow(
          supabase,
          row,
          {
            body_preview: `Voicemail (${recordingDuration ?? "?"}s) — transcript pending`,
          },
          {
            status: "voicemail",
            recording_sid: recordingSid,
            recording_url: recordingUrl ? `${recordingUrl}.mp3` : null,
            recording_duration_seconds: recordingDuration,
          }
        );
      }
    } catch (err) {
      console.error(
        "[twilio-voice] voicemail: DB error:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return twiml(
    `<Say voice="Polly.Matthew-Neural">Got it — thanks. I'll get back to you shortly.</Say><Hangup/>`
  );
}
