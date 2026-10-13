/**
 * Pipeline scoreboard — the year, in commission dollars.
 *
 * CRE deals run 6–18 months, so a kanban alone reads as "nothing moved".
 * This layer answers the questions that keep a broker going:
 *   • Where am I against the number?      (closed YTD + weighted in-flight vs goal)
 *   • When does the money land?           (18-month horizon, dated or projected)
 *   • Which deals are the year?           (biggest open fees, how long they've run)
 *   • What have I already won?            (closed this year)
 *   • Is the board moving?                (stage moves in 30 days, stale deals)
 *
 * Projection rule: a deal with no expected_close is placed by its stage's
 * typical remaining runway (see RUNWAY_MONTHS) and flagged `projected`, so
 * the horizon is never empty — but every projected bar nudges toward a
 * real date.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeStage, getStageConfig, type StageKey } from "./stage-config";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

/** Typical months left from this stage to close (6–18 month cycles). */
const RUNWAY_MONTHS: Record<StageKey, number> = {
  Lead: 12,
  Prospecting: 11,
  Qualifying: 9,
  BOV: 8,
  "Pre-listing": 7,
  "Active Listing": 6,
  LOI: 4,
  Underwriting: 3,
  "Due Diligence": 2,
  Financing: 1.5,
  Closing: 0.5,
  "Post-close": 0,
  Closed: 0,
};

export interface ScoreDeal {
  id: string;
  name: string;
  dealType: string | null;
  stage: StageKey;
  price: number | null;
  estimatedCommission: number;
  probabilityPct: number;
  weightedCommission: number;
  /** ISO date — expected_close, or the projection when missing */
  closeDate: string;
  projected: boolean;
  monthsInPipeline: number;
  daysInStage: number;
  stale: boolean;
  propertySlug: string | null;
  propertyName: string | null;
}

export interface HorizonMonth {
  key: string;      // YYYY-MM
  label: string;    // "Nov", "Jan '27"
  dated: number;    // weighted commission with a real expected_close
  projected: number;
  deals: Array<{ id: string; name: string; weighted: number; projected: boolean }>;
}

export interface Scoreboard {
  year: number;
  goal: number | null;
  closedYtd: { amount: number; count: number; deals: Array<{ id: string; name: string; amount: number; closedOn: string | null }> };
  inFlight: { count: number; estimated: number; weighted: number };
  horizon: HorizonMonth[];
  unscheduled: number;
  topDeals: ScoreDeal[];
  momentum: { movesLast30d: number; staleCount: number; lastMove: string | null };
}

const SLA: Record<StageKey, number> = {
  Lead: 5, Prospecting: 7, Qualifying: 10, BOV: 14, "Pre-listing": 14, "Active Listing": 90,
  LOI: 7, Underwriting: 21, "Due Diligence": 30, Financing: 30, Closing: 14, "Post-close": 365, Closed: 365,
};

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(d: Date, now: Date): string {
  const m = d.toLocaleDateString("en-US", { month: "short" });
  return d.getFullYear() === now.getFullYear() ? m : `${m} ’${String(d.getFullYear()).slice(2)}`;
}

export async function loadScoreboard(now = new Date()): Promise<Scoreboard> {
  const sb = createServerSupabase();
  const year = now.getFullYear();

  const [{ data: dealsRaw }, { data: goalRow }] = await Promise.all([
    sb
      .from("deals")
      .select(
        `id, deal_name, deal_type, price, estimated_commission, probability_pct, expected_close,
         actual_close, is_closed, is_dead, created_at,
         property:properties(id, name, slug, is_dead),
         deal_stages(stage, entered_at, exited_at)`
      )
      .eq("organization_id", ORG_ID)
      .eq("is_dead", false),
    sb.from("broker_targets").select("commission_goal").eq("organization_id", ORG_ID).eq("year", year).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = (dealsRaw ?? []) as any[];
  const yearStart = new Date(year, 0, 1);

  // ── Closed this year ────────────────────────────────────────────────────
  const closedDeals = deals
    .filter((d) => d.is_closed && !(d.property && d.property.is_dead))
    .map((d) => {
      const closedStage = (d.deal_stages ?? []).find((s: { stage: string }) => normalizeStage(s.stage) === "Closed");
      const closedOn: string | null = d.actual_close ?? closedStage?.entered_at ?? null;
      return { id: d.id as string, name: (d.deal_name as string) ?? "Untitled deal", amount: Number(d.estimated_commission ?? 0), closedOn };
    })
    .filter((d) => d.closedOn && new Date(d.closedOn) >= yearStart)
    .sort((a, b) => b.amount - a.amount);
  const closedYtd = {
    amount: closedDeals.reduce((s, d) => s + d.amount, 0),
    count: closedDeals.length,
    deals: closedDeals,
  };

  // ── Open deals, scored ──────────────────────────────────────────────────
  let movesLast30d = 0;
  let lastMove: string | null = null;
  const thirtyAgo = new Date(now.getTime() - 30 * 86_400_000);

  const open: ScoreDeal[] = deals
    .filter((d) => !d.is_closed && !(d.property && d.property.is_dead))
    .map((d) => {
      const stages = (d.deal_stages ?? []) as Array<{ stage: string; entered_at: string | null; exited_at: string | null }>;
      for (const s of stages) {
        if (s.entered_at && new Date(s.entered_at) >= thirtyAgo && new Date(s.entered_at) <= now) movesLast30d += 1;
        if (s.entered_at && (!lastMove || s.entered_at > lastMove) && new Date(s.entered_at) <= now) lastMove = s.entered_at;
      }
      const active = stages.find((s) => !s.exited_at) ?? [...stages].sort((a, b) => (b.entered_at ?? "").localeCompare(a.entered_at ?? ""))[0];
      const stage = normalizeStage(active?.stage);
      const enteredAt = active?.entered_at ? new Date(active.entered_at) : null;
      const daysInStage = enteredAt ? Math.max(0, Math.floor((now.getTime() - enteredAt.getTime()) / 86_400_000)) : 0;
      const created = d.created_at ? new Date(d.created_at) : now;
      const monthsInPipeline = Math.max(0, (now.getTime() - created.getTime()) / (30.44 * 86_400_000));
      const estimated = Number(d.estimated_commission ?? 0);
      const probability = d.probability_pct != null ? Number(d.probability_pct) : getStageConfig(stage).defaultProbability;
      const projected = !d.expected_close;
      let close: Date;
      if (d.expected_close) {
        close = new Date(d.expected_close);
        // A target date already in the past still counts as "now-ish".
        if (close < now) close = new Date(now.getFullYear(), now.getMonth(), 15);
      } else {
        close = new Date(now.getTime() + RUNWAY_MONTHS[stage] * 30.44 * 86_400_000);
      }
      return {
        id: d.id,
        name: d.deal_name ?? d.property?.name ?? "Untitled deal",
        dealType: d.deal_type ?? null,
        stage,
        price: d.price != null ? Number(d.price) : null,
        estimatedCommission: estimated,
        probabilityPct: probability,
        weightedCommission: estimated * (probability / 100),
        closeDate: close.toISOString().slice(0, 10),
        projected,
        monthsInPipeline,
        daysInStage,
        stale: daysInStage > (SLA[stage] ?? 14),
        propertySlug: d.property?.slug ?? null,
        propertyName: d.property?.name ?? null,
      };
    });

  // ── 18-month horizon ────────────────────────────────────────────────────
  const horizon: HorizonMonth[] = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    horizon.push({ key: monthKey(d), label: monthLabel(d, now), dated: 0, projected: 0, deals: [] });
  }
  const byKey = new Map(horizon.map((m) => [m.key, m]));
  for (const deal of open) {
    if (deal.weightedCommission <= 0) continue;
    const m = byKey.get(deal.closeDate.slice(0, 7)) ?? horizon[horizon.length - 1];
    if (deal.projected) m.projected += deal.weightedCommission;
    else m.dated += deal.weightedCommission;
    m.deals.push({ id: deal.id, name: deal.name, weighted: deal.weightedCommission, projected: deal.projected });
  }

  return {
    year,
    goal: goalRow?.commission_goal != null ? Number(goalRow.commission_goal) : null,
    closedYtd,
    inFlight: {
      count: open.length,
      estimated: open.reduce((s, d) => s + d.estimatedCommission, 0),
      weighted: open.reduce((s, d) => s + d.weightedCommission, 0),
    },
    horizon,
    unscheduled: open.filter((d) => d.projected).length,
    topDeals: [...open].sort((a, b) => b.estimatedCommission - a.estimatedCommission).slice(0, 6),
    momentum: { movesLast30d, staleCount: open.filter((d) => d.stale).length, lastMove },
  };
}
