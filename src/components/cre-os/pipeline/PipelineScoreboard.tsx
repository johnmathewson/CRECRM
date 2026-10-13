"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { Scoreboard, ScoreDeal } from "@/lib/cre-os/scoreboard-queries";

/**
 * PipelineScoreboard — the year, in commission dollars, above the board.
 *
 * Built for 6–18 month deals, where a kanban that hasn't moved this week
 * is normal and demoralizing. Four things, in this order:
 *   1. The number: closed YTD + what's weighted in flight, against the goal.
 *   2. The horizon: when the money lands over the next 18 months.
 *   3. The deals that ARE the year, with how long they've been running.
 *   4. The wins so far.
 *
 * Brand: White fields on Bone, 2px Ink rules, Copper for the one thing
 * that matters on each field. No exclamation points.
 */

const money = (n: number, digits = 0) => {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(digits)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};
const moneyFull = (n: number) => `$${Math.round(n).toLocaleString()}`;

const COPPER = "#B4552F";
const COPPER_LIGHT = "#E2966F";
const INK = "#191D21";
const INK_500 = "#9AA0A6";

export function PipelineScoreboard({ data }: { data: Scoreboard }) {
  const router = useRouter();
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalText, setGoalText] = useState(data.goal ? String(Math.round(data.goal)) : "");
  const [saving, setSaving] = useState(false);

  const closed = data.closedYtd.amount;
  const weighted = data.inFlight.weighted;
  const goal = data.goal ?? 0;
  const ceiling = Math.max(goal, closed + data.inFlight.estimated, 1);
  const pctClosed = Math.min(100, (closed / ceiling) * 100);
  const pctWeighted = Math.min(100 - pctClosed, (weighted / ceiling) * 100);
  const pctGoalMark = goal > 0 ? Math.min(100, (goal / ceiling) * 100) : null;
  const onPace = goal > 0 ? closed + weighted >= goal : null;
  const gapToGoal = goal > 0 ? Math.max(0, goal - closed - weighted) : 0;

  const monthsLeft = 12 - new Date().getMonth();

  async function saveGoal() {
    const n = Number(goalText.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/pipeline/goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: data.year, goal: n }),
      });
      if (res.ok) {
        setEditingGoal(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  const chart = useMemo(
    () => data.horizon.map((m) => ({ ...m, total: m.dated + m.projected })),
    [data.horizon]
  );
  const maxMonth = Math.max(1, ...chart.map((m) => m.total));

  return (
    <div className="space-y-6">
      {/* ── 1. The number ──────────────────────────────────────────────── */}
      <section className="bg-steward-surface px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div>
            <div className="font-heading text-[10px] font-bold uppercase tracking-eyebrow text-coral-400">
              {data.year} · closed commission
            </div>
            <div className="mt-1 font-display text-[44px] font-extrabold leading-none text-cream tabular-nums">
              {moneyFull(closed)}
            </div>
            <div className="mt-2 font-body text-[14px] text-cream-muted">
              {data.closedYtd.count === 0
                ? "Nothing closed yet this year."
                : `${data.closedYtd.count} deal${data.closedYtd.count === 1 ? "" : "s"} closed`}
              <span className="mx-2 text-cream-subtle">·</span>
              <span className="text-cream">{money(weighted)}</span> more in flight, probability-weighted
              <span className="mx-2 text-cream-subtle">·</span>
              {money(data.inFlight.estimated)} if everything lands
            </div>
          </div>

          <div className="text-right">
            <div className="font-heading text-[10px] font-bold uppercase tracking-eyebrow text-cream-muted">The number</div>
            {editingGoal ? (
              <div className="mt-1 flex items-center gap-2 justify-end">
                <span className="font-display text-[24px] font-bold text-cream">$</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={goalText}
                  onChange={(e) => setGoalText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveGoal();
                    if (e.key === "Escape") setEditingGoal(false);
                  }}
                  className="w-40 border-2 border-cream bg-steward-surface px-2 py-1 font-display text-[24px] font-bold text-cream tabular-nums focus:outline-none focus:border-coral-400"
                  placeholder="250000"
                />
                <button
                  onClick={() => void saveGoal()}
                  disabled={saving}
                  className="px-3 py-2 bg-copper-600 text-white font-heading text-[12px] font-semibold hover:bg-copper-700 disabled:opacity-50"
                >
                  {saving ? "Saving" : "Save"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingGoal(true)}
                className="mt-1 font-display text-[28px] font-bold leading-none text-cream tabular-nums hover:text-coral-400 transition-colors"
                title="Set the annual commission goal"
              >
                {goal > 0 ? moneyFull(goal) : "Set your number"}
              </button>
            )}
            {goal > 0 && (
              <div className="mt-2 font-body text-[13px] text-cream-muted">
                {onPace ? (
                  <span className="text-cream">On pace — closed plus weighted pipeline covers it.</span>
                ) : (
                  <>
                    <span className="text-cream">{money(gapToGoal)}</span> still to find
                    <span className="text-cream-subtle"> · {monthsLeft} month{monthsLeft === 1 ? "" : "s"} left</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Progress — closed (Copper), weighted (Copper light), goal mark (Ink) */}
        <div className="mt-5 relative h-4 bg-ink-200">
          <div className="absolute inset-y-0 left-0 bg-copper-600" style={{ width: `${pctClosed}%` }} />
          <div className="absolute inset-y-0 bg-copper-300" style={{ left: `${pctClosed}%`, width: `${pctWeighted}%` }} />
          {pctGoalMark !== null && (
            <div className="absolute -top-1 -bottom-1 w-[3px] bg-ink-900" style={{ left: `calc(${pctGoalMark}% - 1px)` }} title="Goal" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-heading text-[10px] font-bold uppercase tracking-eyebrow text-cream-muted">
          <span><span className="inline-block w-2.5 h-2.5 bg-copper-600 mr-1.5 align-[-1px]" />Closed {money(closed)}</span>
          <span><span className="inline-block w-2.5 h-2.5 bg-copper-300 mr-1.5 align-[-1px]" />Weighted in flight {money(weighted)}</span>
          {goal > 0 && <span><span className="inline-block w-[3px] h-2.5 bg-ink-900 mr-1.5 align-[-1px]" />Goal {money(goal)}</span>}
          <span className="ml-auto normal-case tracking-normal font-body font-normal text-[12px]">
            Moves in 30 days: <span className="text-cream font-semibold">{data.momentum.movesLast30d}</span>
            {data.momentum.staleCount > 0 && (
              <> · <span className="text-coral-400 font-semibold">{data.momentum.staleCount} stale</span></>
            )}
          </span>
        </div>
      </section>

      {/* ── 2. The horizon ─────────────────────────────────────────────── */}
      <section className="bg-steward-surface px-5 py-5">
        <div className="flex items-baseline justify-between gap-4 flex-wrap border-b-2 border-cream pb-2">
          <h2 className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream">When the money lands · next 18 months</h2>
          <span className="font-body text-[12px] text-cream-muted">
            Weighted commission by month. <span className="inline-block w-2.5 h-2.5 bg-copper-600 mx-1 align-[-1px]" /> dated
            <span className="inline-block w-2.5 h-2.5 bg-copper-300 ml-3 mr-1 align-[-1px]" /> projected from stage
          </span>
        </div>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_500, fontFamily: "inherit" }} axisLine={{ stroke: INK, strokeWidth: 2 }} tickLine={false} />
              <YAxis
                width={52}
                tick={{ fontSize: 11, fill: INK_500, fontFamily: "inherit" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`)}
                domain={[0, Math.ceil(maxMonth / 10000) * 10000 || 10000]}
              />
              <Tooltip
                cursor={{ fill: "rgba(25,29,33,0.06)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const m = payload[0].payload as (typeof chart)[number];
                  return (
                    <div className="bg-steward-surface border-2 border-cream px-3 py-2 font-body text-[12px] text-cream">
                      <div className="font-heading font-bold">{m.label} · {money(m.total)}</div>
                      {m.deals.map((d) => (
                        <div key={d.id} className="mt-1 flex justify-between gap-4">
                          <span className="truncate max-w-[220px]">{d.name}{d.projected ? " (projected)" : ""}</span>
                          <span className="tabular-nums">{money(d.weighted)}</span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Bar dataKey="dated" stackId="m" fill={COPPER} isAnimationActive={false} />
              <Bar dataKey="projected" stackId="m" fill={COPPER_LIGHT} isAnimationActive={false}>
                {chart.map((m) => (
                  <Cell key={m.key} fill={COPPER_LIGHT} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {data.unscheduled > 0 && (
          <p className="mt-2 font-body text-[13px] text-cream-muted">
            <span className="text-cream font-semibold">{data.unscheduled} deal{data.unscheduled === 1 ? "" : "s"}</span> have no target close date, so they're
            placed by stage. Set a date on the deal and the bar moves to where you actually expect it.
          </p>
        )}
      </section>

      {/* ── 3. The deals that are the year ─────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6">
        <section className="bg-steward-surface px-5 py-5">
          <div className="flex items-baseline justify-between border-b-2 border-cream pb-2">
            <h2 className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream">The deals that are the year</h2>
            <span className="font-mono text-[12px] text-cream-subtle">{data.inFlight.count} open</span>
          </div>
          {data.topDeals.length === 0 ? (
            <p className="py-6 font-body text-[14px] text-cream-muted">No open deals. Add one and it lands here.</p>
          ) : (
            <div>
              {data.topDeals.map((d) => (
                <DealLine key={d.id} d={d} />
              ))}
            </div>
          )}
        </section>

        <section className="bg-steward-surface px-5 py-5">
          <div className="flex items-baseline justify-between border-b-2 border-cream pb-2">
            <h2 className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream">Won in {data.year}</h2>
            <span className="font-mono text-[12px] font-semibold text-coral-400">{money(closed)}</span>
          </div>
          {data.closedYtd.deals.length === 0 ? (
            <p className="py-6 font-body text-[14px] text-cream-muted">The first close of the year goes here.</p>
          ) : (
            <div>
              {data.closedYtd.deals.map((d) => (
                <div key={d.id} className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-2.5">
                  <div className="min-w-0">
                    <div className="font-heading text-[14px] font-semibold text-cream truncate">{d.name}</div>
                    {d.closedOn && (
                      <div className="font-body text-[12px] text-cream-subtle">
                        {new Date(d.closedOn).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    )}
                  </div>
                  <div className="font-mono text-[14px] font-semibold text-cream tabular-nums">{moneyFull(d.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DealLine({ d }: { d: ScoreDeal }) {
  const months = Math.round(d.monthsInPipeline);
  const closeLabel = new Date(d.closeDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  const href = `/cre-os/pipeline/${d.id}`;
  return (
    <Link href={href} className="flex items-center gap-4 border-b border-white/[0.06] py-3 hover:bg-white/[0.03] -mx-2 px-2 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-[15px] font-semibold text-cream truncate">{d.name}</span>
          {d.stale && (
            <span className="shrink-0 bg-copper-600 px-1.5 py-px font-heading text-[9px] font-bold uppercase tracking-eyebrow text-white">
              stale
            </span>
          )}
        </div>
        <div className="mt-0.5 font-body text-[13px] text-cream-muted">
          <span className="bg-ink-200 px-1.5 py-px font-heading text-[10px] font-bold uppercase tracking-eyebrow text-ink-700 mr-2">
            {d.stage}
          </span>
          {months === 0 ? "new this month" : `${months} month${months === 1 ? "" : "s"} in`}
          <span className="text-cream-subtle"> · {d.daysInStage}d in stage · </span>
          {d.projected ? `projected ${closeLabel}` : `closing ${closeLabel}`}
        </div>
        {/* Runway bar: how far along a 6–18 month deal is */}
        <div className="mt-2 h-1.5 bg-ink-200 max-w-md">
          <div className="h-full bg-copper-600" style={{ width: `${Math.min(100, (d.monthsInPipeline / 18) * 100)}%` }} />
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-display text-[20px] font-bold text-cream tabular-nums leading-none">{money(d.estimatedCommission, 1)}</div>
        <div className="mt-1 font-body text-[12px] text-cream-muted tabular-nums">
          {Math.round(d.probabilityPct)}% · {money(d.weightedCommission, 1)} weighted
        </div>
      </div>
    </Link>
  );
}
