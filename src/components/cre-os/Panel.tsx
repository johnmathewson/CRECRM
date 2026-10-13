"use client";

import { Eyebrow } from "./Eyebrow";

/**
 * Panel — the universal container for a section of content on a CRE OS page.
 * Brand: a White field lifted off the Bone canvas, flush-left eyebrow and
 * title, a 2px Ink rule under the header. No radius, no shadow.
 *
 * Variants:
 *   • default: white field
 *   • flat: no field, just an eyebrow + rule (inline content blocks)
 *   • elevated: same as default (kept for API compatibility)
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
  const surface = variant === "flat" ? "" : "bg-steward-surface border border-white/[0.05]";

  return (
    <section className={`${surface} ${className}`}>
      {(eyebrow || title || actions) && (
        <div className={variant === "flat" ? "mb-3" : "px-4 pt-4 pb-3"}>
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && <Eyebrow num={num}>{eyebrow}</Eyebrow>}
              {title && (
                <h2 className="mt-1 font-heading text-base font-bold text-cream tracking-tight">
                  {title}
                </h2>
              )}
            </div>
            {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
          </div>
          <div className="mt-3 h-[2px] bg-cream" />
        </div>
      )}
      <div className={variant === "flat" ? "" : "px-4 pb-4"}>{children}</div>
    </section>
  );
}
