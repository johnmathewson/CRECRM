"use client";

import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { getStageConfig, normalizeStage } from "@/lib/cre-os/stage-config";

/**
 * StageGuidance — the "system tightening around the workflow" panel. For the
 * deal's current stage, surfaces:
 *   • required fields (must be set to advance)
 *   • document checklist (must exist)
 *   • recommended next actions
 *   • common risks
 *
 * Static config today (src/lib/cre-os/stage-config.ts). Phase 3.5 will let
 * the user mark items complete and surface a "ready to advance" pill when
 * everything's checked.
 */
export function StageGuidance({ stage }: { stage: string | null }) {
  const cfg = getStageConfig(stage);

  return (
    <Panel eyebrow="Stage guidance" num={1} title={`${cfg.label} — what's expected`}>
      <p className="font-body text-[12px] text-cream-dim leading-relaxed">{cfg.description}</p>
      <div className="mt-3 inline-block px-2 py-0.5 rounded bg-coral-400/10 border border-coral-400/30 font-mono text-[10px] text-coral-300">
        Default probability: {cfg.defaultProbability}%
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <GuidanceList eyebrow="Required fields" items={cfg.requiredFields} emptyMessage="None — admin only stage." />
        <GuidanceList eyebrow="Document checklist" items={cfg.docChecklist} emptyMessage="No required documents." />
        <GuidanceList eyebrow="Recommended actions" items={cfg.recommendedActions} tone="coral" />
        <GuidanceList eyebrow="Common risks" items={cfg.commonRisks} tone="amber" />
      </div>
    </Panel>
  );
}

function GuidanceList({
  eyebrow,
  items,
  tone = "muted",
  emptyMessage = "—",
}: {
  eyebrow: string;
  items: string[];
  tone?: "muted" | "coral" | "amber";
  emptyMessage?: string;
}) {
  const eyebrowTone = tone === "muted" ? "muted" : tone === "coral" ? "coral" : "muted";
  return (
    <div>
      <Eyebrow tone={eyebrowTone}>{eyebrow}</Eyebrow>
      {items.length === 0 ? (
        <p className="mt-2 font-body text-[12px] text-cream-subtle italic">{emptyMessage}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 font-body text-[12px] text-cream-dim leading-snug">
              <span className={`mt-1 w-1 h-1 rounded-full shrink-0 ${tone === "coral" ? "bg-coral-400" : tone === "amber" ? "bg-amber" : "bg-cream-subtle"}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
