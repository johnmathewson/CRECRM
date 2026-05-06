"use client";

import { Eyebrow } from "./Eyebrow";

/**
 * Panel — the universal container for a section of content on a CRE OS page.
 * Editorial: hairline-bordered card on the steward-surface ground, eyebrow at
 * top, optional actions on the right.
 *
 * Variants:
 *   • default: subtle border, surface bg
 *   • flat: no bg, just an eyebrow + hairline (for inline content blocks)
 *   • elevated: soft shadow, used sparingly for primary panels
 */
export function Panel({
  eyebrow,
  num,
  title,
  actions,
  children,
  variant = "default",
  className = "",
}: {
  eyebrow?: string;
  num?: number;
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  variant?: "default" | "flat" | "elevated";
  className?: string;
}) {
  const surface =
    variant === "flat"
      ? ""
      : variant === "elevated"
        ? "bg-steward-surface/60 border border-white/[0.06] rounded-md shadow-panel-soft"
        : "bg-steward-surface/40 border border-white/[0.05] rounded-md";

  return (
    <section className={`${surface} ${className}`}>
      {(eyebrow || title || actions) && (
        <div className={variant === "flat" ? "mb-3" : "px-5 pt-4 pb-3"}>
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && <Eyebrow num={num}>{eyebrow}</Eyebrow>}
              {title && (
                <h2 className="mt-1 font-heading text-base font-semibold text-cream tracking-tight">
                  {title}
                </h2>
              )}
            </div>
            {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
          </div>
          {variant !== "flat" && (
            <div className="mt-3 h-px bg-gradient-to-r from-coral-400/30 via-white/5 to-transparent" />
          )}
        </div>
      )}
      <div className={variant === "flat" ? "" : "px-5 pb-5"}>{children}</div>
    </section>
  );
}
