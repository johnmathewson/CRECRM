"use client";

/**
 * StatusBadge — small uppercase pill for stage / status / urgency labels.
 * Tones map to brand semantics: coral = primary/active, teal = positive/done,
 * amber = warning, dim = muted/inactive.
 */
export function StatusBadge({
  children,
  tone = "neutral",
  size = "sm",
}: {
  children: React.ReactNode;
  tone?: "coral" | "teal" | "amber" | "neutral" | "danger";
  size?: "sm" | "xs";
}) {
  const toneClass = {
    coral:   "bg-coral-400/12 text-coral-300 ring-1 ring-inset ring-coral-400/25",
    teal:    "bg-teal-400/12 text-teal-300 ring-1 ring-inset ring-teal-400/25",
    amber:   "bg-amber/10 text-amber ring-1 ring-inset ring-amber/25",
    neutral: "bg-white/[0.06] text-cream-dim ring-1 ring-inset ring-white/10",
    danger:  "bg-red-500/12 text-red-300 ring-1 ring-inset ring-red-400/30",
  }[tone];

  const sizeClass = size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center font-heading font-semibold uppercase tracking-eyebrow rounded ${sizeClass} ${toneClass}`}
    >
      {children}
    </span>
  );
}
