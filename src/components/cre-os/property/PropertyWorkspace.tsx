"use client";

import { AppShell } from "@/components/cre-os/AppShell";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import { PropertyHeader } from "./PropertyHeader";
import { PropertyAISummary } from "./PropertyAISummary";
import { PropertyTabs } from "./PropertyTabs";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

/**
 * PropertyWorkspace — the full single-property page. Stack:
 *   PropertyHeader (sticky-feeling, full-width masthead)
 *   PropertyAISummary (the "brain of the asset" band)
 *   PropertyTabs (Overview · Valuation & Comps · Performance · Activity)
 *
 * Right rail: property-scoped insights derived from the same data the AI
 * summary used. One source of truth, two surfaces.
 */
export function PropertyWorkspace({ p }: { p: PropertyDetail }) {
  const rail: RailSection[] = [
    {
      eyebrow: "Asset insights",
      insights: p.insights.length > 0
        ? p.insights.map((i) => ({
            id: i.id,
            confidence: 100,
            headline: i.headline,
            caption: i.caption,
            href: i.href,
            tone: i.tone,
          }))
        : [{
            id: "no-insights",
            confidence: 100,
            headline: "Asset is calm",
            caption: "No urgent signals detected. Owner update, comp drift, and lead surges will surface here as they happen.",
            tone: "neutral",
          }],
    },
    {
      eyebrow: "Activity at a glance",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Inbound leads" value={p.leads.length.toString()} />
          <RailStat label="Open tasks" value={p.tasks.length.toString()} />
          <RailStat label="Linked deals" value={p.deals.length.toString()} />
          <RailStat label="Activity entries" value={p.activity.length.toString()} />
          <RailStat label="Key contacts" value={p.keyContacts.length.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <RailAction label="Run BOV" href={`/valuate?address=${encodeURIComponent([p.address, p.city, p.state].filter(Boolean).join(", ") || p.name)}`} />
          <RailAction label="Generate OM" href="#" disabled />
          <RailAction label="Send owner update" href="#" disabled />
          <RailAction label="Add a task" href="#" disabled />
          <RailAction label="View public listing" href="#" disabled />
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <PropertyHeader p={p} />
      <PropertyAISummary p={p} />
      <PropertyTabs p={p} />
    </AppShell>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold">{value}</span>
    </div>
  );
}

function RailAction({ label, href, disabled }: { label: string; href: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle cursor-not-allowed">
        {label}
        <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
      </div>
    );
  }
  return (
    <a
      href={href}
      className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
    >
      {label}
    </a>
  );
}
