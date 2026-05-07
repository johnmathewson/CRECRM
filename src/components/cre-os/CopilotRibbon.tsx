"use client";

import { Eyebrow } from "./Eyebrow";

/**
 * CopilotRibbon — the AI's morning briefing band. Sits between the page header
 * and the KPI strip on the Command Center. Greets the user, summarizes today's
 * priorities in one line, and exposes 4-6 single-tap focus chips.
 *
 * Each chip is a saved query that drops the user into the right inbox/pipeline/
 * lead view filtered to that bucket. Chips are tappable, badged with the count.
 */
export interface CopilotChip {
  /** Short label, e.g. "Hot leads" */
  label: string;
  /** Numeric count badge — typed-coral when > 0, dim when 0 */
  count: number;
  /** Tone hint for the chip — coral for action-required, teal for positive, amber for risk */
  tone?: "coral" | "teal" | "amber" | "neutral";
  /** Where the chip leads when tapped */
  href: string;
  /** Optional subtitle line under the label */
  caption?: string;
}

export function CopilotRibbon({
  greeting,
  summary,
  chips,
  onOpenAssistant,
}: {
  greeting: string;
  summary?: string;
  chips: CopilotChip[];
  onOpenAssistant?: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-md border border-coral-400/25 bg-gradient-to-r from-steward-surfaceHi/80 via-steward-mid/60 to-steward-surface/40 backdrop-blur-md">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-coral-400" />
      <div className="px-5 py-4 flex items-start gap-6 flex-wrap">
        {/* Greeting + summary */}
        <div className="flex-1 min-w-[240px]">
          <Eyebrow tone="coral">AI Copilot</Eyebrow>
          <div className="mt-1 font-heading text-base text-cream font-medium">{greeting}</div>
          {summary && <div className="mt-1 font-body text-[13px] text-cream-dim">{summary}</div>}
        </div>

        {/* Focus chips */}
        <div className="flex flex-wrap items-stretch gap-2">
          {chips.map((c) => (
            <CopilotChipItem key={c.label} chip={c} />
          ))}
          {onOpenAssistant && (
            <button
              onClick={onOpenAssistant}
              className="px-3 py-2 rounded-md bg-coral-400 hover:bg-coral-500 text-steward-base font-heading text-[12px] font-semibold uppercase tracking-eyebrow transition-colors"
            >
              Open Copilot
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CopilotChipItem({ chip }: { chip: CopilotChip }) {
  const tone = chip.tone ?? "coral";
  const dim = chip.count === 0;
  const toneClass = dim
    ? "border-white/10 bg-white/[0.02] text-cream-subtle hover:bg-white/[0.04]"
    : {
        coral: "border-coral-400/40 bg-coral-400/[0.06] text-cream hover:bg-coral-400/[0.10]",
        teal: "border-teal-400/40 bg-teal-400/[0.06] text-cream hover:bg-teal-400/[0.10]",
        amber: "border-amber/40 bg-amber/[0.06] text-cream hover:bg-amber/[0.10]",
        neutral: "border-white/15 bg-white/[0.04] text-cream hover:bg-white/[0.06]",
      }[tone];

  const countClass = dim
    ? "text-cream-subtle"
    : {
        coral: "text-coral-300",
        teal: "text-teal-300",
        amber: "text-amber",
        neutral: "text-cream-dim",
      }[tone];

  return (
    <a
      href={chip.href}
      className={`flex items-center gap-3 px-3 py-2 rounded border transition-colors ${toneClass}`}
    >
      <span className={`font-display font-medium text-xl leading-none ${countClass}`}>{chip.count}</span>
      <span className="flex flex-col items-start leading-tight">
        <span className="font-heading text-[11px] font-semibold uppercase tracking-eyebrow">
          {chip.label}
        </span>
        {chip.caption && (
          <span className="font-body text-[10px] text-cream-subtle">{chip.caption}</span>
        )}
      </span>
    </a>
  );
}
