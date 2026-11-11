/**
 * POST /api/deal-checkins/items/[id]/answer
 *
 * John answers one check-in question — a quick-answer tap, a typed or
 * dictated sentence, or both. We:
 *   1. log it on the deal's timeline (activities, type "note"), so the
 *      next night's agent and the deal page both see it;
 *   2. ask Sonnet what, if anything, the answer changes on the deal and
 *      return those as suggestions. Nothing is applied here — John
 *      accepts or skips them in the UI (see ../resolve).
 *
 * Body: { choice?: string, text?: string }
 * Returns: { item, suggestions: Suggestions | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";
import { PIPELINE_LADDER, normalizeStage } from "@/lib/cre-os/stage-config";
import { chicagoDate } from "@/lib/agents/deal-checkin";
import { sanitizeSuggestions, type CheckinSuggestions } from "@/lib/cre-os/checkin-suggestions";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

const SYSTEM = `You turn a commercial real estate broker's quick check-in answer into proposed updates for one deal. He accepts or rejects each one; nothing is applied without him.

Return ONLY JSON:
{
  "note": "the answer rewritten as one clean timeline line, his facts only, e.g. 'Blue Cloud wants 60 days DD; LOI expected Friday.'",
  "stage": one of ${JSON.stringify(PIPELINE_LADDER)} or null,
  "probability_pct": 0-100 or null,
  "expected_close": "YYYY-MM-DD" or null,
  "next_step": "the next concrete action and who owns it" or null,
  "next_step_due": "YYYY-MM-DD" or null,
  "close_outcome": "dead" | "lost" | "won" or null,
  "close_reason": "short reason" or null
}

Rules:
- Propose a field ONLY if the answer clearly implies it changed. Unchanged → null.
- stage: only when the answer says the deal moved (e.g. "LOI signed" → "LOI"). Never move backwards unless he says so.
- close_outcome only when he says the deal is dead, lost, or closed.
- Resolve relative dates ("Friday", "next week", "end of month") against today's date given below.
- Never invent numbers or dates he didn't give.`;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { choice?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const choice = (body.choice ?? "").trim().slice(0, 80) || null;
  const text = (body.text ?? "").trim().slice(0, 4000) || null;
  if (!choice && !text) return NextResponse.json({ error: "Tap an answer or type one." }, { status: 400 });

  const { data: item } = await sb
    .from("deal_checkin_items")
    .select(`id, question, answered_at, deal_id,
             deal:deals(id, deal_name, deal_type, price, probability_pct, expected_close, next_step, next_step_due,
                        property_id, client_contact_id, deal_stages(stage, entered_at, exited_at))`)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "Check-in question not found" }, { status: 404 });
  const deal = (item as any).deal;
  if (!deal) return NextResponse.json({ error: "That deal no longer exists" }, { status: 404 });

  const stages = ((deal.deal_stages ?? []) as any[]);
  const active = stages.find((s) => !s.exited_at) ?? stages.sort((a, b) => b.entered_at.localeCompare(a.entered_at))[0];
  const currentStage = normalizeStage(active?.stage);
  const answer = [choice, text].filter(Boolean).join(" — ");
  const now = new Date().toISOString();

  // 1. Timeline entry. Logged first so the answer is never lost, whatever
  //    happens with the suggestion call below.
  const { data: act, error: actErr } = await sb
    .from("activities")
    .insert({
      organization_id: ORG_ID,
      activity_type: "note",
      subject: `Check-in: ${item.question}`.slice(0, 300),
      body: answer,
      occurred_at: now,
      deal_id: deal.id,
      property_id: deal.property_id ?? null,
      contact_id: deal.client_contact_id ?? null,
      created_by: USER_ID,
    })
    .select("id")
    .single();
  if (actErr) return NextResponse.json({ error: `Couldn't log the answer: ${actErr.message}` }, { status: 500 });

  // 2. Suggestions.
  let suggestions: CheckinSuggestions | null = null;
  let suggestError: string | null = null;
  try {
    const res = await callAnthropic({
      model: MODELS.SONNET,
      system: SYSTEM,
      maxTokens: 400,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          `Today: ${chicagoDate()}`,
          `Deal: ${deal.deal_name} (${deal.deal_type})`,
          `Current: stage ${currentStage} · probability ${deal.probability_pct ?? "—"}% · price ${deal.price ?? "—"}` +
            ` · target close ${deal.expected_close ?? "not set"} · next step ${deal.next_step ?? "none"}${deal.next_step_due ? ` (due ${deal.next_step_due})` : ""}`,
          `Question asked: ${item.question}`,
          `His answer: ${answer}`,
        ].join("\n"),
      }],
    });
    suggestions = sanitizeSuggestions(parseJsonResponse(res.text), {
      stage: currentStage,
      probability_pct: deal.probability_pct,
      expected_close: deal.expected_close,
      next_step: deal.next_step,
      next_step_due: deal.next_step_due,
    });
  } catch (err) {
    suggestError = err instanceof Error ? err.message : String(err);
  }

  const { data: updated, error: upErr } = await sb
    .from("deal_checkin_items")
    .update({
      answered_at: now,
      answer_choice: choice,
      answer_text: text,
      activity_id: act.id,
      suggested_changes: suggestions,
    })
    .eq("id", item.id)
    .select("id, answered_at, answer_choice, answer_text, suggested_changes")
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // A clean note is nicer on the timeline than the raw dictation.
  if (suggestions?.note) {
    await sb.from("activities").update({ body: `${suggestions.note}\n\n(${answer})` }).eq("id", act.id);
  }

  return NextResponse.json({ item: updated, suggestions, suggestError });
}
