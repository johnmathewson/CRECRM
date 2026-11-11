/**
 * Deal check-in agent — runs nightly at 8:45 PM Central.
 *
 * For every open deal it reads the deal row, its stage history, recent
 * emails/texts with the deal's property and client contact, the timeline
 * (activities) and John's earlier check-in answers, then asks Sonnet for:
 *
 *   • a short read of where the deal stands, the next step, and any risk
 *     → stored on the deal (agent_summary / agent_next_step / agent_risk;
 *       next_step itself is John's and only changes when he accepts one)
 *   • whether the deal is worth one question tonight, and that question
 *     with 3–4 one-tap answers → a deal_checkin_items row
 *
 * The best few become tonight's check-in (deal_checkins) and John gets
 * one text with the link. Nothing here changes a deal's stage, price,
 * probability or close date, and nothing is sent to anyone but John:
 * changes only ever come from John accepting a suggestion in the UI.
 *
 * Idempotent per Chicago date: a night that already has answers is left
 * alone; an unanswered one is rebuilt when run again with force.
 */

import { createClient } from "@supabase/supabase-js";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";
import { getStageConfig, normalizeStage } from "@/lib/cre-os/stage-config";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

/** Most questions in one night's check-in. */
export const CHECKIN_MAX_ITEMS = 5;
/** Comms older than this don't go into the deal's context. */
const COMMS_LOOKBACK_DAYS = 45;

/**
 * Service-role client built here rather than via @/lib/supabase/admin:
 * that module imports next/headers, which doesn't resolve when this runs
 * inside a Netlify function (the same ESM trap that silenced Steward).
 */
function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function chicagoDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
}

export interface RunDealCheckinOptions {
  /** Rebuild tonight's check-in even if one exists (unless it has answers). */
  force?: boolean;
  /** Don't text John (manual runs from the UI). */
  skipNotify?: boolean;
}

export interface RunDealCheckinResult {
  checkinId: string | null;
  checkinDate: string;
  dealsReviewed: number;
  items: number;
  skipped?: string;
  notified: boolean;
  errors: string[];
}

interface DealContext {
  deal: any;
  stage: string;
  daysInStage: number | null;
  lastCheckinAnswerDays: number | null;
  daysSinceAnyTouch: number | null;
  prompt: string;
}

interface AgentRead {
  status_summary: string;
  next_step: string | null;
  next_step_due: string | null;
  risk: string | null;
  ask_tonight: boolean;
  urgency: number;
  why_now: string;
  question: string;
  quick_answers: string[];
}

const SYSTEM = `You are the deal desk for Stewardship CRE, a one-broker commercial real estate brokerage in Northwest Indiana / Chicagoland. The broker, John, carries most of each deal's real status in his head: calls, texts from his own phone, meetings. The CRM only sees some of his email. Your job each night is to keep his pipeline honest with as little of his time as possible.

For ONE deal you get its record, stage history, recent emails/texts the CRM saw, its timeline notes, and John's earlier check-in answers. Return ONLY a JSON object:

{
  "status_summary": "1–2 sentences: where the deal actually stands, from the evidence. Say what's unknown.",
  "next_step": "the single next concrete action and who owns it, e.g. 'Buyer's lender to issue term sheet' — or null if unclear",
  "next_step_due": "YYYY-MM-DD if a date is evident, else null",
  "risk": "one short sentence on what could kill or stall it, or null",
  "ask_tonight": true/false,
  "urgency": 1-5,
  "why_now": "short reason this deal needs John tonight (shown to him)",
  "question": "ONE specific question for John",
  "quick_answers": ["3 or 4 short one-tap answers, under 30 characters each"]
}

Rules:
- The question must be specific to this deal's evidence — name the person, document, date or number you're asking about. Never ask "any updates?".
- Answerable in one tap or one sentence from his phone. One question, not two joined with "and".
- quick_answers cover the likely outcomes (e.g. "Signed", "Still waiting", "Pushed a week", "Deal is dead"). No "Other" — he can always type.
- ask_tonight = true when the deal is stalled, a date is near or past, something new arrived, the next step is unclear, or John hasn't updated it in 5+ days. false when he answered about it in the last 2 days and nothing new happened.
- urgency: 5 = money at risk this week, 1 = fine to ask next week.
- Voice: direct, plain, numbers-forward. No broker-speak.
- Never invent facts. If the evidence is thin, say so in status_summary and ask the question that fills the biggest gap.`;

function daysBetween(fromIso: string | null | undefined, to = new Date()): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((to.getTime() - t) / 86400000);
}

function clip(s: string | null | undefined, n: number): string {
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}

async function buildContext(sb: any, deal: any, today: string): Promise<DealContext> {
  const stageRows = ((deal.deal_stages ?? []) as any[]).sort(
    (a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime()
  );
  const active = stageRows.find((s) => !s.exited_at) ?? stageRows[stageRows.length - 1] ?? null;
  const stage = normalizeStage(active?.stage);
  const daysInStage = daysBetween(active?.entered_at);

  const since = new Date(Date.now() - COMMS_LOOKBACK_DAYS * 86400000).toISOString();
  const ors = [`deal_id.eq.${deal.id}`];
  if (deal.property_id) ors.push(`property_id.eq.${deal.property_id}`);
  if (deal.client_contact_id) ors.push(`contact_id.eq.${deal.client_contact_id}`);

  const [{ data: comms }, { data: acts }, { data: prior }, { data: tasks }] = await Promise.all([
    sb
      .from("communications")
      .select("channel, direction, subject, body_preview, from_address, occurred_at, touch_kind")
      .eq("organization_id", ORG_ID)
      .or(ors.join(","))
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .limit(12),
    sb
      .from("activities")
      .select("activity_type, subject, body, occurred_at")
      .eq("organization_id", ORG_ID)
      .eq("deal_id", deal.id)
      .order("occurred_at", { ascending: false })
      .limit(10),
    sb
      .from("deal_checkin_items")
      .select("question, answer_choice, answer_text, answered_at, created_at")
      .eq("deal_id", deal.id)
      .order("created_at", { ascending: false })
      .limit(4),
    sb
      .from("tasks")
      .select("title, due_date, status")
      .eq("organization_id", ORG_ID)
      .neq("status", "completed")
      .or(`deal_id.eq.${deal.id}${deal.property_id ? `,property_id.eq.${deal.property_id}` : ""}`)
      .limit(8),
  ]);

  const lastAnswer = ((prior ?? []) as any[]).find((p) => p.answered_at)?.answered_at ?? null;
  const touchDates = [
    ...((comms ?? []) as any[]).map((c) => c.occurred_at),
    ...((acts ?? []) as any[]).map((a) => a.occurred_at),
  ].filter(Boolean);
  const newestTouch = touchDates.sort().pop() ?? null;

  const p = deal.property;
  const c = deal.contact;
  const lines: string[] = [];
  lines.push(`Today: ${today}`);
  lines.push(`DEAL: ${deal.deal_name ?? "(unnamed)"} — ${deal.deal_type ?? "sale"}`);
  if (p) lines.push(`Property: ${[p.name, p.address, p.city].filter(Boolean).join(", ")}`);
  if (c) lines.push(`Client contact: ${c.full_name}${c.email ? ` <${c.email}>` : ""}`);
  lines.push(
    `Stage: ${getStageConfig(stage).label} for ${daysInStage ?? "?"} days · price ${deal.price ?? "—"}` +
      ` · probability ${deal.probability_pct ?? "—"}% · est. fee ${deal.estimated_commission ?? "—"}` +
      ` · target close ${deal.expected_close ?? "not set"}`
  );
  if (deal.next_step) lines.push(`John's next step: ${deal.next_step}${deal.next_step_due ? ` (due ${deal.next_step_due})` : ""}`);
  if (deal.agent_next_step) lines.push(`Your next step from last night: ${deal.agent_next_step}`);
  if (deal.notes) lines.push(`Deal notes: ${clip(deal.notes, 600)}`);
  lines.push(
    `Stage history: ${stageRows.map((s) => `${normalizeStage(s.stage)} ${String(s.entered_at).slice(0, 10)}`).join(" → ") || "none"}`
  );

  const priorList = (prior ?? []) as any[];
  lines.push(`\nJohn's recent check-in answers (newest first):`);
  if (priorList.length === 0) lines.push("- none yet");
  for (const q of priorList) {
    const ans = q.answered_at ? [q.answer_choice, q.answer_text].filter(Boolean).join(" — ") || "(answered)" : "(not answered)";
    lines.push(`- ${String(q.created_at).slice(0, 10)} Q: ${clip(q.question, 200)} A: ${clip(ans, 300)}`);
  }

  lines.push(`\nTimeline notes (newest first):`);
  if (!acts?.length) lines.push("- none");
  for (const a of (acts ?? []) as any[]) {
    lines.push(`- ${String(a.occurred_at).slice(0, 10)} [${a.activity_type}] ${clip(a.subject, 120)} ${clip(a.body, 300)}`);
  }

  lines.push(`\nEmails/texts the CRM saw, last ${COMMS_LOOKBACK_DAYS} days (newest first):`);
  if (!comms?.length) lines.push("- none");
  for (const m of (comms ?? []) as any[]) {
    lines.push(
      `- ${String(m.occurred_at).slice(0, 10)} ${m.direction ?? ""} ${m.channel ?? ""}${m.touch_kind ? ` (${m.touch_kind})` : ""}` +
        ` from ${clip(m.from_address, 60)}: ${clip(m.subject, 120)} — ${clip(m.body_preview, 280)}`
    );
  }

  if (tasks?.length) {
    lines.push(`\nOpen tasks:`);
    for (const t of tasks as any[]) lines.push(`- ${t.title}${t.due_date ? ` (due ${t.due_date})` : ""}`);
  }

  return {
    deal,
    stage,
    daysInStage,
    lastCheckinAnswerDays: daysBetween(lastAnswer),
    daysSinceAnyTouch: daysBetween(newestTouch),
    prompt: lines.join("\n"),
  };
}

/** Deterministic tiebreak so the agent's urgency isn't the only signal. */
function heuristicScore(ctx: DealContext, today: string): number {
  let s = 0;
  const d = ctx.deal;
  if (ctx.lastCheckinAnswerDays === null || ctx.lastCheckinAnswerDays >= 5) s += 3;
  if (ctx.lastCheckinAnswerDays !== null && ctx.lastCheckinAnswerDays <= 1) s -= 4;
  if (ctx.daysInStage !== null && ctx.daysInStage > 30) s += 2;
  if (d.expected_close) {
    const until = -1 * (daysBetween(d.expected_close + "T00:00:00", new Date(today + "T00:00:00")) ?? 0);
    if (until < 0) s += 3; // close date already passed
    else if (until <= 30) s += 2;
  } else {
    s += 1;
  }
  if (d.next_step_due && d.next_step_due <= today) s += 2;
  if (ctx.daysSinceAnyTouch !== null && ctx.daysSinceAnyTouch <= 2) s += 1; // something new to ask about
  return s;
}

async function readDeal(ctx: DealContext): Promise<{ read: AgentRead | null; usage: { input: number; output: number }; model: string; error?: string }> {
  try {
    const res = await callAnthropic({
      model: MODELS.SONNET,
      system: SYSTEM,
      messages: [{ role: "user", content: ctx.prompt }],
      maxTokens: 700,
      temperature: 0.3,
    });
    const usage = { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 };
    const model = (res.raw?.model as string) ?? MODELS.SONNET;
    const j = parseJsonResponse<any>(res.text);
    if (!j || typeof j.question !== "string" || typeof j.status_summary !== "string") {
      return { read: null, usage, model, error: `unparseable reply for ${ctx.deal.id}` };
    }
    const due = typeof j.next_step_due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.next_step_due) ? j.next_step_due : null;
    return {
      read: {
        status_summary: clip(j.status_summary, 600),
        next_step: j.next_step ? clip(String(j.next_step), 300) : null,
        next_step_due: due,
        risk: j.risk ? clip(String(j.risk), 300) : null,
        ask_tonight: j.ask_tonight !== false,
        urgency: Math.max(1, Math.min(5, Number(j.urgency) || 3)),
        why_now: clip(String(j.why_now ?? ""), 200),
        question: clip(j.question, 300),
        quick_answers: (Array.isArray(j.quick_answers) ? j.quick_answers : [])
          .map((a: unknown) => clip(String(a), 40))
          .filter(Boolean)
          .slice(0, 4),
      },
      usage,
      model,
    };
  } catch (err) {
    return { read: null, usage: { input: 0, output: 0 }, model: MODELS.SONNET, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Run promise-returning jobs with a small concurrency cap. */
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

export async function runDealCheckin(opts: RunDealCheckinOptions = {}): Promise<RunDealCheckinResult> {
  const sb = serviceClient();
  const today = chicagoDate();
  const errors: string[] = [];
  if (!sb) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");

  const { data: existing } = await sb
    .from("deal_checkins")
    .select("id, deal_checkin_items(answered_at)")
    .eq("organization_id", ORG_ID)
    .eq("checkin_date", today)
    .maybeSingle();
  if (existing) {
    const answered = ((existing as any).deal_checkin_items ?? []).some((i: any) => i.answered_at);
    if (answered || !opts.force) {
      return { checkinId: existing.id, checkinDate: today, dealsReviewed: 0, items: 0, skipped: answered ? "already answered" : "already built", notified: false, errors };
    }
    await sb.from("deal_checkins").delete().eq("id", existing.id);
  }

  const { data: dealRows, error: dealErr } = await sb
    .from("deals")
    .select(
      `id, deal_name, deal_type, price, probability_pct, estimated_commission, expected_close, notes,
       next_step, next_step_due, agent_next_step, property_id, client_contact_id,
       property:properties(id, name, address, city, is_dead),
       contact:contacts(id, full_name, email),
       deal_stages(stage, entered_at, exited_at)`
    )
    .eq("organization_id", ORG_ID)
    .eq("is_closed", false)
    .eq("is_dead", false);
  if (dealErr) throw new Error(`deals query failed: ${dealErr.message}`);
  const deals = ((dealRows ?? []) as any[]).filter((d) => !(d.property && d.property.is_dead)).slice(0, 60);

  const contexts = await Promise.all(deals.map((d) => buildContext(sb, d, today)));
  const reads = await pool(contexts, 4, readDeal);

  let tokensIn = 0;
  let tokensOut = 0;
  let model: string = MODELS.SONNET;
  const nowIso = new Date().toISOString();
  const candidates: Array<{ ctx: DealContext; read: AgentRead; score: number }> = [];

  for (let i = 0; i < contexts.length; i++) {
    const { read, usage, error } = reads[i];
    tokensIn += usage.input;
    tokensOut += usage.output;
    model = reads[i].model || model;
    if (error) errors.push(error);
    if (!read) continue;
    const ctx = contexts[i];

    // The agent's read lives on the deal so the deal page and pipeline can
    // show it — in its own columns, never over John's next_step.
    const patch: Record<string, unknown> = {
      agent_summary: read.status_summary,
      agent_next_step: read.next_step,
      agent_risk: read.risk,
      agent_summary_at: nowIso,
    };
    const { error: upErr } = await sb.from("deals").update(patch).eq("id", ctx.deal.id);
    if (upErr) errors.push(`deal ${ctx.deal.id} update: ${upErr.message}`);

    if (read.ask_tonight && read.question) {
      candidates.push({ ctx, read, score: read.urgency * 2 + heuristicScore(ctx, today) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const picked = candidates.slice(0, CHECKIN_MAX_ITEMS);

  const { data: checkin, error: ckErr } = await sb
    .from("deal_checkins")
    .insert({
      organization_id: ORG_ID,
      checkin_date: today,
      deals_reviewed: deals.length,
      model_used: model,
      tokens_input: tokensIn,
      tokens_output: tokensOut,
      error_log: errors,
    })
    .select("id")
    .single();
  if (ckErr || !checkin) throw new Error(`deal_checkins insert failed: ${ckErr?.message}`);

  if (picked.length > 0) {
    const { error: itemErr } = await sb.from("deal_checkin_items").insert(
      picked.map((p, idx) => ({
        organization_id: ORG_ID,
        checkin_id: checkin.id,
        deal_id: p.ctx.deal.id,
        rank: idx + 1,
        why_now: p.read.why_now,
        status_summary: p.read.status_summary,
        question: p.read.question,
        quick_answers: p.read.quick_answers,
      }))
    );
    if (itemErr) {
      errors.push(`items insert: ${itemErr.message}`);
      await sb.from("deal_checkins").update({ error_log: errors }).eq("id", checkin.id);
    }
  }

  let notified = false;
  if (!opts.skipNotify && picked.length > 0) {
    const base = process.env.URL || "https://stewardship-crm.netlify.app";
    const names = picked
      .slice(0, 3)
      .map((p) => clip(p.ctx.deal.property?.name || p.ctx.deal.deal_name, 28))
      .join(", ");
    const body =
      `Deal check-in: ${picked.length} quick question${picked.length === 1 ? "" : "s"} tonight` +
      ` (${names}${picked.length > 3 ? ", …" : ""}). ${base}/cre-os/checkin`;
    try {
      // notifyJohn logs and swallows its own failures, so check the one
      // setting it needs here to record a skipped text honestly.
      if (!process.env.TWILIO_NOTIFY_TO_NUMBER?.trim()) throw new Error("TWILIO_NOTIFY_TO_NUMBER not set");
      const { notifyJohn } = await import("@/lib/twilio-voice");
      await notifyJohn(body);
      notified = true;
      await sb.from("deal_checkins").update({ notified_at: new Date().toISOString() }).eq("id", checkin.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await sb.from("deal_checkins").update({ notify_error: msg }).eq("id", checkin.id);
    }
  }

  return { checkinId: checkin.id, checkinDate: today, dealsReviewed: deals.length, items: picked.length, notified, errors };
}
