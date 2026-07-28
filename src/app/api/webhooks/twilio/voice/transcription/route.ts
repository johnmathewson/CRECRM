/**
 * POST /api/webhooks/twilio/voice/transcription
 *
 * <Record transcribeCallback> — Twilio posts the voicemail transcript
 * ~30–60s after the recording. Merges the text into the call's mirror row
 * (so the stream preview shows the actual message) and appends it to the
 * linked lead's raw_body so the inbox card + AI drafter can see it.
 *
 * Transcription only runs on recordings 2–120s; on failure the row keeps
 * its "transcript pending" preview downgraded to a recording pointer.
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
    console.warn("[twilio-voice] transcription: signature invalid — dropping");
    return NextResponse.json({ ok: true });
  }

  const callSid = params["CallSid"] ?? null;
  const status = params["TranscriptionStatus"] ?? "";
  const text = (params["TranscriptionText"] ?? "").trim();

  if (!callSid) {
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

    if (status === "completed" && text) {
      await updateCallRow(
        supabase,
        row,
        { body_preview: `Voicemail: ${text}`.slice(0, 500) },
        { transcription_status: status, transcription: text }
      );

      if (row.lead_id) {
        const { data: lead } = await supabase
          .from("leads")
          .select("id, raw_body")
          .eq("id", row.lead_id)
          .maybeSingle();
        if (lead) {
          const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
          const entry = `[voicemail ${stamp}Z] ${text}`;
          await supabase
            .from("leads")
            .update({
              raw_body: lead.raw_body ? `${lead.raw_body}\n\n${entry}` : entry,
            })
            .eq("id", lead.id);
        }
      }
    } else {
      await updateCallRow(
        supabase,
        row,
        { body_preview: "Voicemail left — transcription unavailable, listen to the recording" },
        { transcription_status: status || "failed" }
      );
    }
  } catch (err) {
    console.error(
      "[twilio-voice] transcription: DB error:",
      err instanceof Error ? err.message : err
    );
  }

  return NextResponse.json({ ok: true });
}
