/**
 * POST /api/leads/[id]/log-call
 *
 * Records a broker phone-call attempt on a lead. One row per attempt
 * (three voicemails = three log entries), so we can measure activity
 * accurately + feed the "days since last touch" signal on the call
 * priority ranker.
 *
 * Body:
 *   {
 *     outcome: 'reached' | 'left_voicemail' | 'no_answer' | 'wrong_number' |
 *              'callback_requested' | 'converted' | 'dead',
 *     duration_seconds?: number,   // only meaningful for reached/converted
 *     notes?: string,              // freeform, appended to lead.notes too
 *     called_at?: string           // ISO — defaults to now()
 *   }
 *
 * Side effects:
 *   - Inserts call_logs row (source of truth)
 *   - Appends notes to lead.notes if provided (so the notes stay visible
 *     on the existing LeadDetail view — no UI hunting for the call trail)
 *   - Emits a lead_events row for audit + Steward briefing
 *
 * Returns: { ok, call_log_id }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

const VALID_OUTCOMES = new Set([
  // Call outcomes
  "reached",
  "left_voicemail",
  "no_answer",
  "wrong_number",
  "callback_requested",
  "converted",
  "dead",
  // Text outcomes
  "sent",
  "reply_received",
]);

const VALID_CHANNELS = new Set(["call", "text"]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: {
    channel?: string;
    outcome?: string;
    duration_seconds?: number;
    notes?: string;
    called_at?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const channel = body.channel ?? "call";
  if (!VALID_CHANNELS.has(channel)) {
    return NextResponse.json(
      { error: `channel must be one of: ${Array.from(VALID_CHANNELS).join(", ")}` },
      { status: 400 }
    );
  }

  if (!body.outcome || !VALID_OUTCOMES.has(body.outcome)) {
    return NextResponse.json(
      { error: `outcome required, one of: ${Array.from(VALID_OUTCOMES).join(", ")}` },
      { status: 400 }
    );
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load lead → we need contact_id + property_id + current notes to append.
  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select("id, contact_id, property_id, notes, sender_phone")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const calledAt = body.called_at ?? new Date().toISOString();
  const notes = body.notes?.trim() || null;

  // Insert the call_logs row (channel discriminates call vs text)
  const { data: log, error: insertErr } = await sb
    .from("call_logs")
    .insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      contact_id: lead.contact_id,
      called_at: calledAt,
      // Duration only meaningful for calls — text logs ignore it
      duration_seconds: channel === "call" ? body.duration_seconds ?? null : null,
      outcome: body.outcome,
      channel,
      notes,
    })
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Mirror into communications — the universal log the dashboard + coverage
  // check read from. call_logs stays the granular source of truth (outcome,
  // duration); this row makes the touch filterable alongside email/SMS.
  // external_id call_log:<id> keeps it idempotent if this ever re-runs.
  const isInboundText = channel === "text" && body.outcome === "reply_received";
  const { error: commErr } = await sb.from("communications").insert({
    organization_id: ORG_ID,
    lead_id: lead.id,
    contact_id: lead.contact_id,
    property_id: lead.property_id,
    channel: channel === "text" ? "sms" : "phone",
    direction: isInboundText ? "inbound" : "outbound",
    external_id: `call_log:${log.id}`,
    subject: null,
    body_preview: notes ?? `${channel === "text" ? "Text" : "Call"}: ${body.outcome}`,
    from_address: isInboundText ? lead.sender_phone ?? null : null,
    ...(isInboundText ? {} : lead.sender_phone ? { to_addresses: [lead.sender_phone] } : {}),
    occurred_at: calledAt,
    ...(isInboundText ? {} : { touch_kind: "manual" }),
    raw_payload: {
      source: "call_log",
      call_log_id: log.id,
      outcome: body.outcome,
      duration_seconds: body.duration_seconds ?? null,
    },
  });
  if (commErr) {
    console.error("[log-call] comm mirror insert failed:", commErr.message);
  }

  // Append the touch to lead.notes so it's visible on the existing
  // LeadDetail view even before the Call List UI ships everywhere.
  // Format: "[Called 2026-07-06 · reached · 4m30s] Left message about pricing"
  //     or: "[Texted 2026-07-06 · sent] Sent follow-up on rate"
  const verb = channel === "text" ? "Texted" : "Called";
  const shouldAppend = channel === "text" ? true : (!!notes || body.outcome !== "no_answer");
  if (shouldAppend) {
    const dur = channel === "call" && body.duration_seconds
      ? ` · ${Math.floor(body.duration_seconds / 60)}m${body.duration_seconds % 60}s`
      : "";
    const stamp = new Date(calledAt).toISOString().slice(0, 10);
    const line = `[${verb} ${stamp} · ${body.outcome}${dur}]${notes ? ` ${notes}` : ""}`;
    const merged = lead.notes ? `${lead.notes}\n${line}` : line;
    await sb
      .from("leads")
      .update({ notes: merged, updated_at: new Date().toISOString() })
      .eq("id", lead.id);
  }

  // Audit trail — best-effort, don't fail the touch log on this
  try {
    await sb.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      event_type: channel === "text" ? "text_logged" : "call_logged",
      actor: "user",
      summary: `${verb} logged: ${body.outcome}${notes ? ` — ${notes.slice(0, 80)}` : ""}`,
      metadata: {
        channel,
        outcome: body.outcome,
        duration_seconds: body.duration_seconds ?? null,
        call_log_id: log.id,
      },
    });
  } catch (e) {
    console.error("[log-call] lead_events insert failed:", e);
  }

  return NextResponse.json({ ok: true, call_log_id: log.id });
}

// ── GET — list call logs on this lead (for the panel to render) ──────────
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await sb
    .from("call_logs")
    .select("id, called_at, duration_seconds, outcome, notes, channel")
    .eq("organization_id", ORG_ID)
    .eq("lead_id", params.id)
    .order("called_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: data ?? [] });
}
