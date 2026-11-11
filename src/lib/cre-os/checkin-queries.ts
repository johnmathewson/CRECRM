import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeStage, type StageKey } from "@/lib/cre-os/stage-config";
import type { CheckinSuggestions } from "@/lib/cre-os/checkin-suggestions";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface CheckinItem {
  id: string;
  rank: number;
  whyNow: string | null;
  statusSummary: string | null;
  question: string;
  quickAnswers: string[];
  answeredAt: string | null;
  answerChoice: string | null;
  answerText: string | null;
  suggestions: CheckinSuggestions | null;
  appliedAt: string | null;
  skippedAt: string | null;
  deal: {
    id: string;
    name: string;
    dealType: string | null;
    stage: StageKey;
    price: number | null;
    probabilityPct: number | null;
    expectedClose: string | null;
    nextStep: string | null;
    propertyName: string | null;
    city: string | null;
  };
}

export interface Checkin {
  id: string;
  date: string;
  createdAt: string;
  dealsReviewed: number;
  items: CheckinItem[];
}

/**
 * The most recent check-in (tonight's, or the last one built). Questions
 * answered and resolved stay in the list as "done" so the page shows the
 * whole night, not just what's left.
 */
export async function loadLatestCheckin(): Promise<Checkin | null> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("deal_checkins")
    .select(
      `id, checkin_date, created_at, deals_reviewed,
       deal_checkin_items(id, rank, why_now, status_summary, question, quick_answers, answered_at, answer_choice,
         answer_text, suggested_changes, applied_at, skipped_at,
         deal:deals(id, deal_name, deal_type, price, probability_pct, expected_close, next_step,
           property:properties(name, city), deal_stages(stage, entered_at, exited_at)))`
    )
    .eq("organization_id", ORG_ID)
    .order("checkin_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const items: CheckinItem[] = (((data as any).deal_checkin_items ?? []) as any[])
    .filter((i) => i.deal)
    .sort((a, b) => a.rank - b.rank)
    .map((i) => {
      const d = i.deal;
      const stages = (d.deal_stages ?? []) as any[];
      const active = stages.find((s) => !s.exited_at) ?? [...stages].sort((a, b) => String(b.entered_at).localeCompare(String(a.entered_at)))[0];
      return {
        id: i.id,
        rank: i.rank,
        whyNow: i.why_now,
        statusSummary: i.status_summary,
        question: i.question,
        quickAnswers: Array.isArray(i.quick_answers) ? i.quick_answers : [],
        answeredAt: i.answered_at,
        answerChoice: i.answer_choice,
        answerText: i.answer_text,
        suggestions: i.suggested_changes ?? null,
        appliedAt: i.applied_at,
        skippedAt: i.skipped_at,
        deal: {
          id: d.id,
          name: d.deal_name ?? d.property?.name ?? "(unnamed deal)",
          dealType: d.deal_type,
          stage: normalizeStage(active?.stage),
          price: d.price !== null ? Number(d.price) : null,
          probabilityPct: d.probability_pct !== null ? Number(d.probability_pct) : null,
          expectedClose: d.expected_close,
          nextStep: d.next_step,
          propertyName: d.property?.name ?? null,
          city: d.property?.city ?? null,
        },
      };
    });

  return {
    id: data.id,
    date: data.checkin_date,
    createdAt: data.created_at,
    dealsReviewed: data.deals_reviewed,
    items,
  };
}

/** For the Today banner: questions still waiting on John in the latest check-in. */
export function openCount(c: Checkin | null): number {
  if (!c) return 0;
  return c.items.filter((i) => !i.answeredAt).length;
}
