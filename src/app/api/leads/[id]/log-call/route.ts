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
  "reached",
  "left_voicemail",
  "no_answer",
  "wrong_number",
  "callback_requested",
  "converted",
  "dead",
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: {
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

  // Load lead → we need contact_id + current notes to append.
  const { data: lead, error: leadErr } = await sb
    .from("leads")
    .select("id, contact_id, notes")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (leadErr) return NextResponse.json({ error: leadErr.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const calledAt = body.called_at ?? new Date().toISOString();
  const notes = body.notes?.trim() || null;

  // Insert the call_logs row
  const { data: log, error: insertErr } = await sb
    .from("call_logs")
    .insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      contact_id: lead.contact_id,
      called_at: calledAt,
      duration_seconds: body.duration_seconds ?? null,
      outcome: body.outcome,
      notes,
    })
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Append the call to lead.notes so it's visible on the existing
  // LeadDetail view even before the Call List UI ships everywhere.
  // Format: "[Called 2026-07-06 · reached · 4m30s] Left message about pricing"
  if (notes || body.outcome !== "no_answer") {
    const dur = body.duration_seconds
      ? ` · ${Math.floor(body.duration_seconds / 60)}m${body.duration_seconds % 60}s`
      : "";
    const stamp = new Date(calledAt).toISOString().slice(0, 10);
    const line = `[Called ${stamp} · ${body.outcome}${dur}]${notes ? ` ${notes}` : ""}`;
    const merged = lead.notes ? `${lead.notes}\n${line}` : line;
    await sb
      .from("leads")
      .update({ notes: merged, updated_at: new Date().toISOString() })
      .eq("id", lead.id);
  }

  // Audit trail — best-effort, don't fail the call log on this
  try {
    await sb.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      event_type: "call_logged",
      actor: "user",
      summary: `Call logged: ${body.outcome}${notes ? ` — ${notes.slice(0, 80)}` : ""}`,
      metadata: {
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
    .select("id, called_at, duration_seconds, outcome, notes")
    .eq("organization_id", ORG_ID)
    .eq("lead_id", params.id)
    .order("called_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ calls: data ?? [] });
}
