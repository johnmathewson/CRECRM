"use client";

import { ACTIVE_STAGES, getStageConfig, normalizeStage, stageIndex } from "@/lib/cre-os/stage-config";

/**
 * StageStepper — visual ladder showing every active stage as a connected
 * sequence of pills. Current stage is filled coral; passed stages are
 * teal-dim; future stages are charcoal. Clicking a stage pill is a
 * placeholder for stage-advance (write path lands when we expose actions).
 */
export function StageStepper({ currentStage }: { currentStage: string | null }) {
  const idx = stageIndex(currentStage);
  const norm = normalizeStage(currentStage);

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {ACTIVE_STAGES.map((s, i) => {
          const isCurrent = norm === s;
          const isPast = idx > -1 && i < idx;
          const cfg = getStageConfig(s);
          const cls = isCurrent
            ? "bg-coral-400 text-steward-base border-coral-400"
            : isPast
              ? "bg-teal-400/15 text-teal-300 border-teal-400/30"
              : "bg-white/[0.02] text-cream-subtle border-white/[0.06]";
          return (
            <div key={s} className="flex items-center gap-1">
              <div
                className={`px-3 py-1.5 rounded border font-heading text-[10px] uppercase tracking-eyebrow font-semibold whitespace-nowrap ${cls}`}
                title={cfg.description}
              >
                {s}
              </div>
              {i < ACTIVE_STAGES.length - 1 && (
                <span className={`text-[10px] ${isPast ? "text-teal-400" : "text-white/15"}`}>→</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
