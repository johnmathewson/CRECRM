"use client";

import { Eyebrow } from "./Eyebrow";
import { InsightCard, InsightItem } from "./InsightCard";

/**
 * InsightsRail — the right-rail intelligence stream that runs the full height
 * of the page. Stack of section blocks: AI insights, automated reminders,
 * leasing velocity, next best actions.
 */
export interface RailSection {
  eyebrow: string;
  insights?: InsightItem[];
  /** Free-form children for non-insight blocks (e.g., a leasing velocity sparkline) */
  children?: React.ReactNode;
}

export function InsightsRail({ sections }: { sections: RailSection[] }) {
  return (
    <aside className="w-[300px] shrink-0 h-full border-l border-white/[0.04] bg-steward-base/30 backdrop-blur-sm overflow-y-auto">
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
  );
}
