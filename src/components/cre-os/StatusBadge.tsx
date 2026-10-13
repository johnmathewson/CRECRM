"use client";

/**
 * StatusBadge — small uppercase tag for stage / status / urgency labels.
 * Brand status tags (Guide p.18):
 *   ACTIVE    = Ink 900 on Copper 200      → tone "coral"
 *   CLOSED    = Ink 700 on Ink 200         → tone "teal" / "neutral"
 *   ATTENTION = White on Copper 600 solid  → tone "danger" (genuinely urgent)
 *   note      = Copper 700 on Copper 100   → tone "amber"
 * Zero radius.
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
    coral:   "bg-copper-200 text-ink-900",
    teal:    "bg-ink-200 text-ink-700",
    amber:   "bg-copper-100 text-copper-700",
    neutral: "bg-ink-200 text-ink-700",
    danger:  "bg-copper-600 text-white",
  }[tone];

  const sizeClass = size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center font-heading font-bold uppercase tracking-eyebrow ${sizeClass} ${toneClass}`}
    >
      {children}
    </span>
  );
}
