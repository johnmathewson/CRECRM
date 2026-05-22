"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIVE_STAGES, getStageConfig, normalizeStage, stageIndex, type StageKey } from "@/lib/cre-os/stage-config";

/**
 * StageStepper — visual ladder showing every active stage as a connected
 * sequence of pills. Current stage is filled coral; passed stages are
 * teal-dim; future stages are charcoal.
 *
 * Phase 8 — clicking a pill now actually advances the deal. Hits
 * /api/deals/[id]/advance which writes a deal_stages row, exits the
 * previous one, and propagates to the paired property's status when the
 * new stage maps forward.
 *
 * The dealId prop is optional: when omitted, the stepper renders read-only
 * (used by lead detail and other views that just want to show position).
 */
export function StageStepper({
  currentStage,
  dealId,
}: {
  currentStage: string | null;
  dealId?: string;
}) {
  const router = useRouter();
  const idx = stageIndex(currentStage);
  const norm = normalizeStage(currentStage);
  const [busy, setBusy] = useState<StageKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function advance(target: StageKey) {
    if (!dealId) return;
    if (target === norm) return;
    setBusy(target);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${dealId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: target }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {ACTIVE_STAGES.map((s, i) => {
            const isCurrent = norm === s;
            const isPast = idx > -1 && i < idx;
            const cfg = getStageConfig(s);
            const isLoading = busy === s;
            const cls = isCurrent
              ? "bg-coral-400 text-steward-base border-coral-400"
              : isPast
                ? "bg-teal-400/15 text-teal-300 border-teal-400/30 hover:bg-teal-400/25"
                : "bg-white/[0.02] text-cream-subtle border-white/[0.06] hover:bg-white/[0.06] hover:text-cream";
            const Tag = dealId ? "button" : "div";
            return (
              <div key={s} className="flex items-center gap-1">
                <Tag
                  {...(dealId ? { onClick: () => advance(s), disabled: !!busy } : {})}
                  className={`px-3 py-1.5 rounded border font-heading text-[10px] uppercase tracking-eyebrow font-semibold whitespace-nowrap transition-colors ${cls} ${dealId ? "cursor-pointer disabled:opacity-50" : ""}`}
                  title={dealId ? `${cfg.description} — click to move here` : cfg.description}
                >
                  {isLoading ? "…" : s}
                </Tag>
                {i < ACTIVE_STAGES.length - 1 && (
                  <span className={`text-[10px] ${isPast ? "text-teal-400" : "text-cream/20"}`}>→</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {error && (
        <div className="mt-2 px-3 py-1.5 rounded border border-red-400/30 bg-red-500/[0.06] font-body text-[11px] text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
