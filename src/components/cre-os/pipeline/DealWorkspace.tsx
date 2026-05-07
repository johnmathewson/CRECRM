"use client";

import { AppShell } from "@/components/cre-os/AppShell";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import { DealHeader } from "./DealHeader";
import { StageStepper } from "./StageStepper";
import { StageGuidance } from "./StageGuidance";
import { getStageConfig, normalizeStage } from "@/lib/cre-os/stage-config";
import type { DealDetail } from "@/lib/cre-os/pipeline-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * DealWorkspace — full deal detail page. Stack: header, stepper, then a
 * 2-column body of (1) stage guidance + history, (2) tasks/activity panels.
 * Right rail surfaces deal-scoped insights and forecast math.
 */
export function DealWorkspace({ d }: { d: DealDetail }) {
  const cfg = getStageConfig(d.stage);
  const weighted =
    d.price && d.probabilityPct !== null
      ? d.price * (d.probabilityPct / 100)
      : d.price && cfg.defaultProbability
        ? d.price * (cfg.defaultProbability / 100)
        : null;

  const insights = synthesizeDealInsights(d);

  const rail: RailSection[] = [
    {
      eyebrow: "Deal forecast",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Deal value" value={fmtMoney(d.price)} />
          <RailStat
            label="Probability"
            value={
              d.probabilityPct !== null
                ? Math.round(d.probabilityPct) + "%"
                : `${cfg.defaultProbability}% (default)`
            }
          />
          <RailStat label="Weighted" value={fmtMoney(weighted)} />
          <RailStat label="Est. commission" value={fmtMoney(d.estimatedCommission)} />
          <RailStat label="Target close" value={d.expectedClose || "—"} />
        </div>
      ),
    },
    {
      eyebrow: "Insights",
      insights: insights.length
        ? insights
        : [{
            id: "calm",
            confidence: 100,
            headline: "Deal looks healthy",
            caption: "No stale-stage flags or missing-field warnings.",
            tone: "teal" as const,
          }],
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          {d.property && (
            <a
              href={`/cre-os/properties/${d.property.slug}`}
              className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
            >
              Open property workspace
            </a>
          )}
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Advance stage <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Mark dead <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <DealHeader d={d} />

      {/* Stage stepper */}
      <div className="mb-6">
        <Eyebrow tone="muted">Pipeline ladder</Eyebrow>
        <div className="mt-2">
          <StageStepper currentStage={d.stage} />
        </div>
      </div>

      {/* Main 2-col body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <StageGuidance stage={d.stage} />

          {/* Stage history */}
          <Panel eyebrow="Stage history" num={2} title={`${d.stageHistory.length} transitions`}>
            {d.stageHistory.length === 0 ? (
              <p className="font-body text-[12px] text-cream-subtle py-4">No stage transitions logged.</p>
            ) : (
              <div className="relative">
                <div className="absolute left-[7px] top-3 bottom-3 w-px bg-white/[0.06]" />
                <div className="space-y-4">
                  {d.stageHistory.map((s) => {
                    const isActive = !s.exitedAt;
                    return (
                      <div key={s.id} className="relative pl-8">
                        <div className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 ${isActive ? "border-coral-400 bg-coral-400/30" : "border-white/15 bg-steward-base"}`} />
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <div>
                            <span className="font-heading text-[12px] font-semibold text-cream">
                              {normalizeStage(s.stage)}
                            </span>
                            {s.stage !== normalizeStage(s.stage) && (
                              <span className="ml-2 font-mono text-[10px] text-cream-subtle">(stored as {s.stage})</span>
                            )}
                          </div>
                          <span className="font-mono text-[10px] text-cream-subtle">
                            {s.enteredAt ? new Date(s.enteredAt).toLocaleDateString() : "—"}
                            {s.exitedAt && <> → {new Date(s.exitedAt).toLocaleDateString()}</>}
                            {isActive && <span className="ml-1 text-coral-300">· active</span>}
                          </span>
                        </div>
                        {s.notes && (
                          <p className="mt-1 font-body text-[11px] text-cream-dim leading-snug">{s.notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel eyebrow="Open tasks" num={3} title={`${d.tasks.length} queued`}>
            {d.tasks.length === 0 ? (
              <p className="font-body text-[12px] text-cream-subtle py-4">No tasks on this deal.</p>
            ) : (
              <div className="space-y-2">
                {d.tasks.map((t) => (
                  <div key={t.id} className="flex items-start gap-2 py-1.5 border-b border-white/[0.04] last:border-b-0">
                    <input type="checkbox" className="mt-1 accent-coral-400" readOnly />
                    <div className="flex-1 min-w-0">
                      <div className="font-body text-[12px] text-cream truncate">{t.title}</div>
                    </div>
                    <StatusBadge size="xs" tone={t.tone}>{t.due}</StatusBadge>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel eyebrow="Recent activity" num={4} title={`${d.activity.length} entries`}>
            {d.activity.length === 0 ? (
              <p className="font-body text-[12px] text-cream-subtle py-4">No activity logged.</p>
            ) : (
              <div className="space-y-3 text-[12px] font-body text-cream-dim">
                {d.activity.slice(0, 8).map((a) => (
                  <div key={a.id} className="flex items-baseline gap-2 border-b border-white/[0.04] pb-2 last:border-b-0">
                    <span className="font-mono text-[10px] text-cream-subtle w-14 shrink-0">{a.when}</span>
                    <div className="flex-1 min-w-0">
                      {a.subject && <div className="text-cream truncate font-medium">{a.subject}</div>}
                      {a.body && <p className="text-cream-dim line-clamp-2 mt-0.5">{a.body}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold">{value}</span>
    </div>
  );
}

function synthesizeDealInsights(d: DealDetail): Array<{ id: string; confidence: number; headline: string; caption: string; tone: "coral" | "teal" | "amber" | "neutral" }> {
  const out: Array<{ id: string; confidence: number; headline: string; caption: string; tone: "coral" | "teal" | "amber" | "neutral" }> = [];
  const cfg = getStageConfig(d.stage);

  if (d.daysInCurrentStage !== null) {
    const sla: Record<string, number> = {
      Lead: 5, Prospecting: 7, Qualifying: 10, BOV: 14, "Pre-listing": 14,
      "Active Listing": 90, LOI: 7, Underwriting: 21, "Due Diligence": 30,
      Financing: 30, Closing: 14, "Post-close": 365, Closed: 365,
    };
    const limit = sla[d.stage] ?? 14;
    if (d.daysInCurrentStage > limit) {
      out.push({
        id: "stale",
        confidence: 100,
        headline: `Stale in ${cfg.label} for ${d.daysInCurrentStage} days`,
        caption: `Past the ${limit}-day SLA for this stage. Worth a status check.`,
        tone: "coral",
      });
    }
  }

  if (d.probabilityPct === null) {
    out.push({
      id: "no-prob",
      confidence: 100,
      headline: "Probability not set",
      caption: `Default ${cfg.defaultProbability}% from stage config is in use. Set explicitly to weight forecast.`,
      tone: "amber",
    });
  }

  if (!d.expectedClose) {
    out.push({
      id: "no-close",
      confidence: 100,
      headline: "Target close date missing",
      caption: "Without a target, the deal disappears from the quarterly forecast.",
      tone: "amber",
    });
  }

  const target = d.expectedClose ? new Date(d.expectedClose) : null;
  if (target && target <= new Date(Date.now() + 7 * 86400000) && !d.isClosed) {
    out.push({
      id: "closing-soon",
      confidence: 100,
      headline: "Closing within the week",
      caption: "Confirm DD checklist, lender, signature path, and wire instructions.",
      tone: "teal",
    });
  }

  if (cfg.docChecklist.length > 0) {
    out.push({
      id: "doc-checklist",
      confidence: 100,
      headline: `${cfg.docChecklist.length} document${cfg.docChecklist.length === 1 ? "" : "s"} expected by end of stage`,
      caption: "See Stage Guidance for the full list.",
      tone: "neutral",
    });
  }

  return out.slice(0, 5);
}
