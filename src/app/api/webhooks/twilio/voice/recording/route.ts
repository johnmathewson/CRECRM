/**
 * POST /api/webhooks/twilio/voice/recording
 *
 * recordingStatusCallback for the <Dial> call recording (answered,
 * forwarded calls — dual-channel, recording starts at answer). Voicemail
 * recordings do NOT land here; they ride the <Record> action at
 * /voice/voicemail and use the recording_* payload keys. Call recordings
 * use call_recording_* keys so the two never collide on the shared row.
 *
 * Fires after the call ends, typically a few seconds behind the Dial
 * action at /voice/complete.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseTwilioWebhook } from "@/lib/twilio-webhook";
import { getCallRow, updateCallRow } from "@/lib/twilio-voice";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilioWebhook(req);
  if (!valid) {
    console.warn("[twilio-voice] recording: signature invalid — dropping");
    return NextResponse.json({ ok: true });
  }

  const callSid = params["CallSid"] ?? null;
  const recordingStatus = params["RecordingStatus"] ?? "";
  const recordingUrl = params["RecordingUrl"] ?? null;
  const recordingSid = params["RecordingSid"] ?? null;
  const recordingDuration = params["RecordingDuration"] ?? null;

  // Only the terminal event matters; in-progress/absent states are noise.
  if (!callSid || recordingStatus !== "completed") {
    return NextResponse.json({ ok: true });
  }

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
        {},
        {
          call_recording_sid: recordingSid,
          call_recording_url: recordingUrl ? `${recordingUrl}.mp3` : null,
          call_recording_duration_seconds: recordingDuration,
        }
      );
    }
  } catch (err) {
    console.error(
      "[twilio-voice] recording: DB error:",
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({ ok: true });
}
