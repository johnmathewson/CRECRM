/**
 * Voice-call helpers shared by the /api/webhooks/twilio/voice/* family.
 *
 * Call lifecycle across webhooks (all keyed on CallSid via
 * communications.external_id — ONE row per call, enriched as it progresses):
 *
 *   /voice          → mirror row inserted, raw_payload.status = 'ringing'
 *   /voice/complete → 'answered' (Dial bridged) or 'voicemail_prompt'
 *   /voice/voicemail→ 'voicemail' + recording url/duration
 *   /voice/transcription → transcript merged into body_preview + lead
 *   /voice/status   → call-ended sweep: 'ringing' at end = caller hung up
 *                     during ring → mark missed + ensure lead + notify
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendSms } from "@/lib/twilio";

export const ORG_ID = "a0000000-0000-0000-0000-000000000001";

/** Where the business line forwards. Locked decision 2026-07-28: John's
 *  cell. Env override exists so the target can change without a code push
 *  (Netlify env change + redeploy). */
export function forwardToNumber(): string {
  return process.env.TWILIO_VOICE_FORWARD_TO?.trim() || "+12197819547";
}

export interface CallRow {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
  property_id: string | null;
  raw_payload: Record<string, unknown> | null;
}

export async function getCallRow(
  sb: SupabaseClient,
  callSid: string
): Promise<CallRow | null> {
  const { data } = await sb
    .from("communications")
    .select("id, lead_id, contact_id, property_id, raw_payload")
    .eq("organization_id", ORG_ID)
    .eq("external_id", callSid)
    .maybeSingle();
  return (data as CallRow | null) ?? null;
}

/** Update the call's mirror row, merging raw_payload instead of replacing
 *  it so earlier webhooks' context (to_phone, recording url…) survives. */
export async function updateCallRow(
  sb: SupabaseClient,
  row: CallRow,
  fields: Partial<{
    body_preview: string;
    lead_id: string;
    contact_id: string;
    property_id: string;
  }>,
  payloadPatch: Record<string, unknown>
): Promise<void> {
  const { error } = await sb
    .from("communications")
    .update({
      ...fields,
      raw_payload: { ...(row.raw_payload ?? {}), ...payloadPatch },
    })
    .eq("id", row.id);
  if (error) {
    console.error("[twilio-voice] call row update failed:", error.message);
  }
}

export async function findContactByPhone(
  sb: SupabaseClient,
  phoneE164: string,
  phoneRaw: string
): Promise<{ id: string; full_name: string | null } | null> {
  const { data } = await sb
    .from("contacts")
    .select("id, full_name")
    .eq("organization_id", ORG_ID)
    .or(`phone.eq.${phoneE164},phone.eq.${phoneRaw}`)
    .maybeSingle();
  return data ?? null;
}

/** Same threading rule as the SMS webhook: an open lead for this phone
 *  within 30 days continues the conversation; otherwise a fresh lead lands
 *  in the inbox as "new". */
export async function ensureLeadForCall(
  sb: SupabaseClient,
  opts: {
    phoneE164: string;
    phoneRaw: string;
    contactId: string | null;
    contactName: string | null;
  }
): Promise<{ id: string; contact_id: string | null; property_id: string | null } | null> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: existing } = await sb
    .from("leads")
    .select("id, contact_id, property_id")
    .eq("organization_id", ORG_ID)
    .or(`sender_phone.eq.${opts.phoneE164},sender_phone.eq.${opts.phoneRaw}`)
    .not("status", "in", '("archived","spam")')
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing?.[0]) return existing[0];

  const who = opts.contactName ?? opts.phoneE164;
  const { data: created, error } = await sb
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      source: "phone",
      status: "new",
      contact_id: opts.contactId,
      sender_name: opts.contactName,
      sender_phone: opts.phoneE164,
      raw_subject: `Missed call from ${who}`,
      urgency: "warm",
    })
    .select("id, contact_id, property_id")
    .maybeSingle();
  if (error) {
    console.error("[twilio-voice] lead insert failed:", error.message);
  }
  return created ?? null;
}

/** SMS John's cell. Never throws — a notify failure must not break TwiML. */
export async function notifyJohn(body: string): Promise<void> {
  try {
    const to = process.env.TWILIO_NOTIFY_TO_NUMBER?.trim();
    if (!to) {
      console.warn("[twilio-voice] TWILIO_NOTIFY_TO_NUMBER not set — skipping notify");
      return;
    }
    await sendSms({ to, body });
  } catch (err) {
    console.error(
      "[twilio-voice] notify SMS failed:",
      err instanceof Error ? err.message : err
    );
  }
}
