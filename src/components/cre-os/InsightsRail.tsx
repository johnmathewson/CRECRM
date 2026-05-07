"use client";

import { Eyebrow } from "./Eyebrow";
import { InsightCard, InsightItem } from "./InsightCard";

/**
 * InsightsRail — the right-rail intelligence stream.
 *
 * Desktop (≥ lg): inline column to the right of main, full height.
 * Mobile (< lg): hidden by default; AppShell shows it as a right-side
 *   drawer when the user taps the sparkles icon in the Topbar. Backdrop
 *   click closes.
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
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`
          flex flex-col bg-steward-base/95 lg:bg-steward-base/30 backdrop-blur-md border-l border-white/[0.04] overflow-y-auto
          /* Mobile: fixed drawer from the right */
          fixed lg:static inset-y-0 right-0 z-50
          w-[88vw] max-w-[340px] lg:w-[300px] shrink-0 h-full
          transition-transform duration-200 ease-out
          ${mobileOpen ? "translate-x-0" : "translate-x-full"} lg:translate-x-0
        `}
      >
        {/* Mobile header (close button) */}
        <div className="lg:hidden px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
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
