"use client";

import { Eyebrow } from "./Eyebrow";

/**
 * KpiTile — a single metric card with editorial typography.
 *
 * Layout:
 *   EYEBROW (coral, uppercase)
 *   $1.68M (display serif, big)
 *   +24%  vs prior year   (mono delta + caption)
 *   ▁▂▄▃▆▅▇▆  (optional sparkline)
 *
 * Multiple tiles sit side-by-side in a horizontal strip at the top of the
 * Command Center. Variant 'compact' is for the right-rail or property-detail
 * use cases.
 */
export function KpiTile({
  label,
  value,
  delta,
  deltaTone = "auto",
  caption,
  sparkline,
  variant = "default",
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral" | "auto";
  caption?: string;
  sparkline?: React.ReactNode;
  variant?: "default" | "compact";
}) {
  // auto: parse delta — leading "+" → up (teal), "-" → down (coral), else neutral
  const resolvedDeltaTone =
    deltaTone === "auto"
      ? delta?.trim().startsWith("+")
        ? "up"
        : delta?.trim().startsWith("-")
          ? "down"
          : "neutral"
      : deltaTone;
  const deltaColor = {
    up: "text-teal-300",
    down: "text-coral-300",
    neutral: "text-cream-muted",
  }[resolvedDeltaTone];

  const padding = variant === "compact" ? "p-4" : "p-5";
  const valueSize = variant === "compact" ? "text-2xl" : "text-3xl";

  return (
    <div className={`bg-steward-surface/40 border border-white/[0.05] rounded-md ${padding} flex flex-col gap-2`}>
      <Eyebrow tone="coral">{label}</Eyebrow>
      <div className={`font-display font-medium ${valueSize} text-cream leading-none tracking-tight`}>
        {value}
      </div>
      {(delta || caption) && (
        <div className="flex items-baseline gap-2 font-mono text-[10px]">
          {delta && <span className={`${deltaColor} font-semibold`}>{delta}</span>}
          {caption && <span className="text-cream-subtle">{caption}</span>}
        </div>
      )}
      {sparkline && <div className="mt-1 h-7 -mx-1">{sparkline}</div>}
    </div>
  );
}
