"use client";

import { Eyebrow } from "./Eyebrow";
import { InsightCard, InsightItem } from "./InsightCard";

/**
 * InsightsRail — the right-rail intelligence stream.
 *
 * Inline only at xl (≥1280px). Below xl, the rail is hidden by default
 * and shown as a right-side drawer when the user taps the sparkles icon
 * in the Topbar. Backdrop click closes.
 *
 * Why xl and not lg: at 1024-1279px (most laptop screens) showing both
 * sidebar (224px) AND rail (300px) inline leaves the main column with
 * only 500-700px, which squeezes 4-across KPI grids and causes content
 * overlap. The rail moves to drawer mode below xl so the broker gets
 * the full content width unless they're on a true desktop monitor.
 */
export interface RailSection {
  eyebrow: string;
  insights?: InsightItem[];
  /** Free-form children for non-insight blocks. */
  children?: React.ReactNode;
}

export function InsightsRail({
  sections,
  mobileOpen = false,
  onClose,
}: {
  sections: RailSection[];
  mobileOpen?: boolean;
  onClose?: () => void;
}) {
  return (
    <>
      {/* Drawer backdrop (visible only when drawer is open below xl) */}
      {mobileOpen && (
        <div
          className="xl:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`
          flex flex-col bg-steward-base/95 xl:bg-steward-base/30 backdrop-blur-md border-l border-white/[0.04] overflow-y-auto
          fixed xl:static inset-y-0 right-0 z-50
          w-[88vw] max-w-[340px] xl:w-[300px] shrink-0 h-full
          transition-transform duration-200 ease-out
          ${mobileOpen ? "translate-x-0" : "translate-x-full"} xl:translate-x-0
        `}
      >
        {/* Drawer header (close button) — visible whenever drawer is shown */}
        <div className="xl:hidden px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
            Insights
          </div>
          <button
            onClick={onClose}
            className="-mr-1 p-2 text-cream-subtle hover:text-cream transition-colors"
            aria-label="Close insights"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
              <line x1="6" y1="18" x2="18" y2="6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5 space-y-6">
          {sections.map((section, i) => (
            <div key={i}>
              <Eyebrow>{section.eyebrow}</Eyebrow>
              <div className="mt-3 space-y-2">
                {section.insights?.map((it) => (
                  <InsightCard key={it.id} item={it} />
                ))}
                {section.children}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
