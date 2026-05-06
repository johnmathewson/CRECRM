"use client";

import { AppShell } from "@/components/cre-os/AppShell";
import { CopilotRibbon } from "@/components/cre-os/CopilotRibbon";
import { KpiTile } from "@/components/cre-os/KpiTile";
import { Sparkline } from "@/components/cre-os/Sparkline";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";

/**
 * Phase 1 — Command Center.
 *
 * This is John's morning view. Three things in tension at once:
 *   1. WHAT IS HAPPENING — KPIs at the top, pipeline preview below
 *   2. WHAT NEEDS ATTENTION — Copilot ribbon + insights rail
 *   3. WHAT TO DO NEXT — task strip + next-best-actions in the rail
 *
 * Data is currently sample / placeholder. Phase 1 ships the layout and visual
 * language; data wiring follows once the structure is approved.
 */

const SAMPLE_KPIS = [
  { label: "Pipeline value", value: "$28.4M", delta: "+18%", caption: "vs prior qtr", series: [12, 14, 13, 16, 18, 17, 22, 24, 28] },
  { label: "NOI (TTM)",       value: "$1.42M", delta: "+9%",  caption: "vs prior yr",  series: [1.1, 1.15, 1.2, 1.18, 1.22, 1.28, 1.32, 1.38, 1.42] },
  { label: "Active listings", value: "12",     delta: "+2",   caption: "vs last month", series: [8, 9, 9, 10, 10, 11, 12, 11, 12] },
  { label: "Hot leads",       value: "7",      delta: "+3",   caption: "this week",    series: [2, 3, 3, 4, 5, 4, 6, 7, 7] },
  { label: "Cap rate (avg)",  value: "7.4%",   delta: "-0.2", caption: "vs prior qtr", series: [7.6, 7.6, 7.5, 7.5, 7.4, 7.5, 7.4, 7.4, 7.4] },
  { label: "Tasks due today", value: "9",      delta: "3 overdue", deltaTone: "down" as const, series: undefined },
];

const SAMPLE_CHIPS = [
  { label: "Hot leads",       count: 7, tone: "coral" as const,   href: "/cre-os/inbox?bucket=hot",       caption: "Need response" },
  { label: "Underwriting",    count: 3, tone: "amber" as const,   href: "/cre-os/pipeline?stage=underwriting", caption: "DD review" },
  { label: "Owner check-ins", count: 4, tone: "neutral" as const, href: "/cre-os/relationships?bucket=owners", caption: "12+ days quiet" },
  { label: "Listings at risk",count: 2, tone: "amber" as const,   href: "/cre-os/listings?bucket=at-risk",     caption: "Traffic dropped" },
  { label: "Closing soon",    count: 1, tone: "teal" as const,    href: "/cre-os/pipeline?stage=closing",      caption: "5 days out" },
];

const SAMPLE_PIPELINE_STAGES = [
  { stage: "Lead",         count: 12, value: "$3.2M",  tone: "neutral" as const },
  { stage: "Qualifying",   count: 8,  value: "$8.5M",  tone: "neutral" as const },
  { stage: "BOV",          count: 5,  value: "$6.1M",  tone: "neutral" as const },
  { stage: "Active",       count: 6,  value: "$10.4M", tone: "coral"  as const },
  { stage: "LOI",          count: 3,  value: "$5.2M",  tone: "amber" as const },
  { stage: "DD",           count: 2,  value: "$3.8M",  tone: "amber" as const },
  { stage: "Closing",      count: 1,  value: "$2.1M",  tone: "teal" as const },
];

const SAMPLE_TASKS = [
  { title: "Send updated OM to Cedar Capital",      property: "315 W 89th · Merrillville",     due: "Today",     tone: "coral" as const },
  { title: "Owner update — Liberty Pointe",         property: "Liberty Pointe · Crown Point",  due: "Today",     tone: "coral" as const },
  { title: "Review BOV draft for 8000 Broadway",    property: "8000 Broadway · Merrillville",  due: "Tomorrow",  tone: "neutral" as const },
  { title: "Tour with Concerto buyer rep",          property: "Various NWI Industrial",         due: "May 8",     tone: "neutral" as const },
  { title: "Follow up — Merrillville Dental lease", property: "315 W 89th · Merrillville",     due: "May 10",    tone: "neutral" as const },
];

const SAMPLE_RAIL: RailSection[] = [
  {
    eyebrow: "AI Insights",
    insights: [
      {
        id: "1",
        confidence: 92,
        headline: "Strong lease-up potential at 315 W 89th",
        caption: "The Merrillville submarket shows improving absorption trends. 4 vacant units at $19/SF could close $250K of annual upside.",
        href: "/cre-os/properties/315-w-89th-merrillville",
        metric: "+$250K NOI",
        tone: "teal",
      },
      {
        id: "2",
        confidence: 78,
        headline: "Consider early refinance on 3 loans",
        caption: "Loans at 6.85%, 7.10%, 7.30% may benefit from rate environment shift this quarter.",
        href: "/cre-os/properties?filter=debt-maturity",
        metric: "$2 savings",
        tone: "coral",
      },
      {
        id: "3",
        confidence: 88,
        headline: "Capitalize on industrial demand",
        caption: "Nearby supply constraints favor landlords. 2 industrial listings under-priced vs comps.",
        href: "/cre-os/listings?asset_type=industrial",
        tone: "teal",
      },
    ],
  },
  {
    eyebrow: "Automated reminders",
    insights: [
      { id: "r1", confidence: 100, headline: "Lease expiration",   caption: "3 leases expiring in 60 days", href: "/cre-os/properties?filter=lease-rollover", tone: "amber" },
      { id: "r2", confidence: 100, headline: "Debt maturity",      caption: "2 loans mature within 90 days", tone: "amber" },
      { id: "r3", confidence: 100, headline: "Investor reporting", caption: "Q2 reports due in 14 days", tone: "neutral" },
    ],
  },
  {
    eyebrow: "Leasing velocity (TTM)",
    children: (
      <div className="bg-white/[0.02] border border-white/[0.05] rounded p-3">
        <div className="font-display text-2xl text-cream leading-none">18.4K SF / mo</div>
        <div className="mt-1 font-mono text-[10px] text-teal-300">+14% vs prior year</div>
        <div className="mt-3 h-12">
          <Sparkline values={[14, 13, 15, 16, 17, 16, 18, 19, 18, 17, 18, 18.4]} tone="teal" />
        </div>
      </div>
    ),
  },
  {
    eyebrow: "Next best actions",
    insights: [
      { id: "n1", confidence: 0, headline: "Follow up with 7 hot leads", caption: "Avg time-to-respond is 3.2 hrs", href: "/cre-os/inbox?bucket=hot", tone: "coral" },
      { id: "n2", confidence: 0, headline: "Schedule site tour: The Avery Office", caption: "Buyer rep waiting on slot", href: "/cre-os/inbox", tone: "coral" },
      { id: "n3", confidence: 0, headline: "Review 5 underwriting alerts", caption: "Cap-rate shifts in your watchlist", href: "/cre-os/pipeline?stage=underwriting", tone: "amber" },
    ],
  },
];

export default function CommandCenter() {
  return (
    <AppShell rail={SAMPLE_RAIL}>
      <div className="space-y-6">
        {/* Greeting + Copilot ribbon */}
        <CopilotRibbon
          greeting="Good morning, John."
          summary="3 leases expire in 60 days · 7 hot leads need follow-up · 1 deal closes Friday."
          chips={SAMPLE_CHIPS}
          onOpenAssistant={() => console.log("open copilot")}
        />

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {SAMPLE_KPIS.map((k) => (
            <KpiTile
              key={k.label}
              label={k.label}
              value={k.value}
              delta={k.delta}
              deltaTone={(k as any).deltaTone}
              caption={k.caption}
              sparkline={k.series ? <Sparkline values={k.series} tone="coral" /> : undefined}
            />
          ))}
        </div>

        {/* Pipeline preview */}
        <Panel eyebrow="Pipeline" num={1} title="Stage health" actions={
          <a href="/cre-os/pipeline" className="font-heading text-[11px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">
            View all →
          </a>
        }>
          <div className="grid grid-cols-7 gap-2">
            {SAMPLE_PIPELINE_STAGES.map((s) => (
              <div key={s.stage} className="bg-white/[0.02] border border-white/[0.04] rounded p-3">
                <div className="flex items-center justify-between">
                  <Eyebrow tone={s.tone === "coral" ? "coral" : "muted"}>{s.stage}</Eyebrow>
                </div>
                <div className="mt-2 font-display text-2xl text-cream leading-none">{s.count}</div>
                <div className="mt-1 font-mono text-[10px] text-cream-subtle">{s.value}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Tasks + recent activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel
            eyebrow="Today"
            num={2}
            title="Tasks & follow-ups"
            actions={<a href="/cre-os/inbox" className="font-heading text-[11px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">All tasks →</a>}
          >
            <div className="space-y-2">
              {SAMPLE_TASKS.map((t, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-b-0">
                  <input type="checkbox" className="mt-1 accent-coral-400" />
                  <div className="flex-1 min-w-0">
                    <div className="font-body text-[13px] text-cream truncate">{t.title}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-cream-subtle">{t.property}</div>
                  </div>
                  <StatusBadge tone={t.tone} size="xs">{t.due}</StatusBadge>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            eyebrow="Recent activity"
            num={3}
            title="What changed today"
          >
            <div className="space-y-3 text-[13px] font-body text-cream-dim">
              <ActivityRow when="2m ago"  who="John" did="updated valuation for" target="315 W 89th" />
              <ActivityRow when="14m ago" who="System" did="imported 38 lease comps from" target="CoStar export" />
              <ActivityRow when="1h ago"  who="John" did="created deal" target="8000 Broadway · Merrillville" />
              <ActivityRow when="2h ago"  who="Apps Script" did="caught new inquiry from" target="CREXi · Cedar Capital" />
              <ActivityRow when="3h ago"  who="John" did="sent OM to" target="Concerto Indiana LLC" />
            </div>
          </Panel>
        </div>

        {/* Footer note — phase indicator */}
        <div className="pt-4 border-t border-white/[0.04] flex items-center justify-between text-[10px] font-mono text-cream-subtle">
          <span>CRE OS · Phase 1 (Command Center) · Build {new Date().toISOString().slice(0,10)}</span>
          <span>Data shown is sample · wiring follows in Phase 1.5</span>
        </div>
      </div>
    </AppShell>
  );
}

function ActivityRow({ when, who, did, target }: { when: string; who: string; did: string; target: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] text-cream-subtle w-16 shrink-0">{when}</span>
      <span className="text-cream font-medium">{who}</span>
      <span>{did}</span>
      <span className="text-coral-300 truncate">{target}</span>
    </div>
  );
}
