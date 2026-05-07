"use client";

import type { WarmthLabel } from "@/lib/cre-os/relationship-queries";

const TONES: Record<WarmthLabel, { label: string; cls: string }> = {
  hot:  { label: "Hot",  cls: "bg-coral-400/15 text-coral-300 ring-coral-400/30" },
  warm: { label: "Warm", cls: "bg-amber/12 text-amber ring-amber/30" },
  cool: { label: "Cool", cls: "bg-teal-400/12 text-teal-300 ring-teal-400/30" },
  cold: { label: "Cold", cls: "bg-white/[0.04] text-cream-subtle ring-white/10" },
};

/**
 * WarmthBadge — small uppercase pill conveying relationship warmth. Score
 * shown as a subtle suffix when present (e.g. "HOT · 78"). Hover via title
 * surfaces the auto/manual provenance.
 */
export function WarmthBadge({
  warmth,
  score,
  manual,
  size = "sm",
}: {
  warmth: WarmthLabel;
  score?: number;
  manual?: boolean;
  size?: "sm" | "xs";
}) {
  const tone = TONES[warmth];
  const sizeCls = size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5";
  const title = manual ? `${tone.label} (set manually)` : `${tone.label} · auto-scored from activity`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 font-heading font-semibold uppercase tracking-eyebrow rounded ring-1 ring-inset ${tone.cls} ${sizeCls}`}
    >
      <span>{tone.label}</span>
      {score !== undefined && (
        <span className="font-mono text-cream-subtle/80 normal-case">· {score}</span>
      )}
    </span>
  );
}
