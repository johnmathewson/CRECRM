"use client";

import { useState } from "react";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";
import type { ThreadSummary } from "@/lib/cre-os/communications-queries";
import type { ListingPerformance } from "@/lib/cre-os/listing-perf-queries";
import { OverviewTab } from "./tabs/OverviewTab";
import { ValuationTab } from "./tabs/ValuationTab";
import { CommunicationsTab } from "./tabs/CommunicationsTab";
import { PerformanceTab } from "./tabs/PerformanceTab";
import { ActivityTab } from "./tabs/ActivityTab";
import { OffersTab } from "./tabs/OffersTab";
import { DocumentsTab } from "./tabs/DocumentsTab";
import { LeadsTab } from "./tabs/LeadsTab";
import type { PropertyLeadsSnapshot } from "@/lib/cre-os/property-leads-queries";

const TABS = [
  { key: "overview",       label: "Overview" },
  { key: "leads",          label: "Leads" },
  { key: "valuation",      label: "Valuation & Comps" },
  { key: "offers",         label: "Offers" },
  { key: "documents",      label: "Documents" },
  { key: "communications", label: "Communications" },
  { key: "performance",    label: "Performance" },
  { key: "activity",       label: "Activity" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/**
 * PropertyTabs — top-level navigation between the workspace tabs. Selected
 * tab renders its content below. Coral-underline active treatment matches
 * the editorial brand language.
 */
export function PropertyTabs({
  p,
  threads,
  perf,
  leads,
}: {
  p: PropertyDetail;
  threads: ThreadSummary[];
  perf: ListingPerformance;
  leads?: PropertyLeadsSnapshot;
}) {
  const [active, setActive] = useState<TabKey>("overview");

  return (
    <div>
      <div className="flex items-center gap-5 lg:gap-6 border-b border-white/[0.06] -mx-4 lg:-mx-1 px-4 lg:px-1 overflow-x-auto no-scrollbar">
        {TABS.map((t) => {
          const isActive = active === t.key;
          const badge =
            t.key === "communications" && threads.length > 0 ? threads.length :
            t.key === "leads" && leads && leads.totals.leadCount > 0 ? leads.totals.leadCount :
            null;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`relative py-3 font-heading text-[12px] uppercase tracking-eyebrow font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                isActive ? "text-cream" : "text-cream-subtle hover:text-cream-dim"
              }`}
            >
              {t.label}
              {badge !== null && (
                <span className="font-mono text-[9px] text-coral-300 normal-case">{badge}</span>
              )}
              {isActive && (
                <span className="absolute left-0 right-0 -bottom-[1px] h-[2px] bg-coral-400" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {active === "overview" && <OverviewTab p={p} />}
        {active === "leads" && leads && <LeadsTab snapshot={leads} propertyId={p.id} propertyName={p.name} />}
        {active === "leads" && !leads && (
          <p className="font-body text-[12.5px] text-cream-subtle py-10 text-center italic">
            Lead data unavailable for this property.
          </p>
        )}
        {active === "valuation" && <ValuationTab p={p} />}
        {active === "offers" && <OffersTab p={p} />}
        {active === "documents" && <DocumentsTab p={p} />}
        {active === "communications" && <CommunicationsTab threads={threads} propertyName={p.name} />}
        {active === "performance" && <PerformanceTab p={p} perf={perf} />}
        {active === "activity" && (
          <ActivityTab p={p} onSwitchTab={(t) => setActive(t)} />
        )}
      </div>
    </div>
  );
}
