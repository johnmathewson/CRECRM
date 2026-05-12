"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { InsightItem } from "@/components/cre-os/InsightCard";
import { PropertyListCard } from "./PropertyListCard";
import { PropertyFeaturedCard } from "./PropertyFeaturedCard";
import { CreatePropertyDialog } from "./CreatePropertyDialog";
import type { PropertyCard } from "@/lib/cre-os/property-queries";

const ASSET_TYPES = ["all", "retail", "office", "industrial", "multifamily", "hospitality", "medical", "land", "mixed_use", "other"];
const STATUSES = ["all", "active", "listed", "leased", "closed", "idea", "draft"];
type TriageBucket = "all" | "hot" | "quiet" | "stale" | "no-bov";

/**
 * PropertyListView — the property intelligence command surface.
 *
 * Layered hierarchy, top to bottom:
 *   1. Portfolio command header — value, NOI, occupancy, AI synthesis line
 *   2. Triage strip — operational filter chips (hot · quiet · stale · no-BOV · all)
 *   3. Today's focus — featured priority cards (assets that matter today)
 *   4. All assets — search/asset/status filters + grid
 *
 * Right rail: AI-interpreted "what needs attention", not bare stats.
 */
export function PropertyListView({ properties }: { properties: PropertyCard[] }) {
  const [q, setQ] = useState("");
  const [assetType, setAssetType] = useState("all");
  const [status, setStatus] = useState("all");
  const [bucket, setBucket] = useState<TriageBucket>("all");
  const [createOpen, setCreateOpen] = useState(false);

  // Triage bucket counts (derived from full set, not filtered)
  const counts = useMemo(() => ({
    all: properties.length,
    hot: properties.filter((p) => p.isHot).length,
    quiet: properties.filter((p) => p.isQuiet).length,
    stale: properties.filter((p) => p.isStale).length,
    noBov: properties.filter((p) => p.isMissingValuation).length,
  }), [properties]);

  // Apply triage bucket → free-text → asset type → status, in that order
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return properties.filter((p) => {
      if (bucket === "hot" && !p.isHot) return false;
      if (bucket === "quiet" && !p.isQuiet) return false;
      if (bucket === "stale" && !p.isStale) return false;
      if (bucket === "no-bov" && !p.isMissingValuation) return false;
      if (assetType !== "all" && p.assetType !== assetType) return false;
      if (status !== "all" && p.status !== status) return false;
      if (term) {
        const hay = [p.name, p.address, p.city, p.state, p.assetType, p.status, p.pipelineStage]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [properties, q, assetType, status, bucket]);

  // Featured priority: top-N by score within current filter (capped, only if score>0)
  const featured = useMemo(
    () =>
      filtered
        .filter((p) => p.priorityScore > 0)
        .sort((a, b) => b.priorityScore - a.priorityScore)
        .slice(0, 4),
    [filtered],
  );

  // The grid below shows everything except what's already featured (avoid dupes)
  const featuredIds = new Set(featured.map((f) => f.id));
  const restOfGrid = filtered.filter((p) => !featuredIds.has(p.id));

  // Portfolio rollup metrics (always full set, not filtered — the command
  // header summarizes EVERYTHING so the broker sees portfolio reality)
  const totalValue = properties.reduce((s, p) => s + (p.askingPrice ?? 0), 0);
  const totalSF = properties.reduce((s, p) => s + (p.sqft ?? 0), 0);
  const totalNoi = properties.reduce((s, p) => s + (p.noi ?? 0), 0);
  const weightedCap = (() => {
    const valueWithCap = properties.filter((p) => p.askingPrice && p.capRate);
    if (!valueWithCap.length) return null;
    const num = valueWithCap.reduce((s, p) => s + (p.askingPrice! * p.capRate!), 0);
    const den = valueWithCap.reduce((s, p) => s + p.askingPrice!, 0);
    return den > 0 ? num / den : null;
  })();

  // Synthesized one-line state of the portfolio
  const synthesisLine = buildSynthesis(properties, counts);

  // AI-interpretive right rail (replaces stat dump)
  const insights: InsightItem[] = buildInsights(properties);
  const rail: RailSection[] = [
    {
      eyebrow: "What needs attention",
      insights: insights.length
        ? insights
        : [{
            id: "calm",
            confidence: 100,
            headline: "Portfolio looks calm",
            caption: "No urgent triage signals. Good day to source.",
            tone: "teal" as const,
          }],
    },
    {
      eyebrow: "Pulse",
      children: <PortfolioPulse counts={counts} />,
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <a href="/valuate" className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors">
            New valuation
          </a>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Add property <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Generate weekly portfolio report <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        {/* ─── 1. Portfolio command header ─── */}
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="coral">Properties · Asset intelligence</Eyebrow>
            <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Portfolio command surface</h1>
            {synthesisLine && (
              <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
                {synthesisLine}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <CommandStat label="Assets" value={properties.length.toString()} caption="On the books" />
              <CommandStat label="Aggregate value" value={fmtMoney(totalValue)} caption="Asking price sum" />
              <CommandStat label="In-place NOI" value={fmtMoney(totalNoi)} caption="Across portfolio" />
              <CommandStat label="Weighted cap" value={weightedCap !== null ? (weightedCap * 100).toFixed(2) + "%" : "—"} caption="$-weighted average" />
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="shrink-0 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
          >
            + Add property
          </button>
        </header>

        {/* ─── 2. Triage strip — operational filter chips ─── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle mr-2">Triage</span>
          <TriageChip label="Hot" count={counts.hot} active={bucket === "hot"} tone="coral" onClick={() => setBucket(bucket === "hot" ? "all" : "hot")} />
          <TriageChip label="Quiet" count={counts.quiet} active={bucket === "quiet"} tone="neutral" onClick={() => setBucket(bucket === "quiet" ? "all" : "quiet")} />
          <TriageChip label="Stale" count={counts.stale} active={bucket === "stale"} tone="amber" onClick={() => setBucket(bucket === "stale" ? "all" : "stale")} />
          <TriageChip label="Missing val" count={counts.noBov} active={bucket === "no-bov"} tone="amber" onClick={() => setBucket(bucket === "no-bov" ? "all" : "no-bov")} />
          <div className="h-5 w-px bg-white/[0.08] mx-1" />
          <TriageChip label="All" count={counts.all} active={bucket === "all"} tone="neutral" onClick={() => setBucket("all")} />
        </div>

        {/* ─── 3. Today's focus — featured priority assets ─── */}
        {featured.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <Eyebrow tone="coral" num={1}>Today's focus</Eyebrow>
              <span className="font-mono text-[10px] text-cream-subtle">
                {featured.length} priorit{featured.length === 1 ? "y" : "ies"} · sorted by urgency
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {featured.map((p) => <PropertyFeaturedCard key={p.id} p={p} />)}
            </div>
          </section>
        )}

        {/* ─── 4. All assets — filters + grid ─── */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <Eyebrow tone="muted" num={featured.length > 0 ? 2 : 1}>
              {bucket === "all" ? "All assets" : labelForBucket(bucket)}
            </Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">
              {restOfGrid.length}{featured.length > 0 ? ` · plus ${featured.length} featured above` : ""}
            </span>
          </div>

          {/* Filters */}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, address, city, asset type…"
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-base lg:text-[13px] text-cream placeholder:text-cream-subtle font-body outline-none focus:border-coral-400/40 focus:bg-white/[0.06] transition-colors"
              />
            </div>
            <FilterSelect label="Asset" value={assetType} onChange={setAssetType} options={ASSET_TYPES} />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES} />
          </div>

          {restOfGrid.length === 0 ? (
            <Panel>
              <p className="font-body text-[13px] text-cream-subtle py-8 text-center">
                {filtered.length === 0
                  ? "No properties match. Clear filters to see everything."
                  : "Everything in this view is already featured above."}
              </p>
            </Panel>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {restOfGrid.map((p) => <PropertyListCard key={p.id} p={p} />)}
            </div>
          )}
        </section>
      </div>
      <CreatePropertyDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function CommandStat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="bg-steward-mid/40 border border-white/[0.05] rounded-md p-4">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-display font-medium text-2xl text-cream leading-none">{value}</div>
      {caption && <div className="mt-1 font-mono text-[9px] text-cream-subtle">{caption}</div>}
    </div>
  );
}

function TriageChip({
  label, count, active, tone, onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: "coral" | "amber" | "neutral";
  onClick: () => void;
}) {
  const dim = count === 0 && !active;
  const baseClass = active
    ? {
        coral:   "border-coral-400 bg-coral-400/[0.15] text-cream",
        amber:   "border-amber bg-amber/[0.15] text-cream",
        neutral: "border-cream-dim bg-white/[0.10] text-cream",
      }[tone]
    : dim
      ? "border-white/[0.06] bg-white/[0.01] text-cream-subtle hover:bg-white/[0.04]"
      : {
          coral:   "border-coral-400/30 bg-coral-400/[0.04] text-cream hover:bg-coral-400/[0.08]",
          amber:   "border-amber/30 bg-amber/[0.04] text-cream hover:bg-amber/[0.08]",
          neutral: "border-white/15 bg-white/[0.02] text-cream-dim hover:bg-white/[0.06]",
        }[tone];

  const countClass = active
    ? { coral: "text-coral-300", amber: "text-amber", neutral: "text-cream" }[tone]
    : dim
      ? "text-cream-subtle"
      : { coral: "text-coral-300", amber: "text-amber", neutral: "text-cream-dim" }[tone];

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-colors ${baseClass}`}
    >
      <span className="font-heading text-[10px] font-semibold uppercase tracking-eyebrow">{label}</span>
      <span className={`font-mono text-[11px] font-semibold ${countClass}`}>{count}</span>
    </button>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-base lg:text-[12px] text-cream font-body outline-none focus:border-coral-400/40 transition-colors"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-steward-base">
            {o === "all" ? "All" : o.replace("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

function PortfolioPulse({ counts }: { counts: { all: number; hot: number; quiet: number; stale: number; noBov: number } }) {
  const calmPct = counts.all
    ? Math.round(((counts.all - counts.hot - counts.stale) / counts.all) * 100)
    : 100;
  return (
    <div className="space-y-2 text-[11px] font-body text-cream-dim">
      <PulseRow label="Calm" pct={calmPct} tone="teal" />
      <PulseRow label="Hot" pct={counts.all ? Math.round((counts.hot / counts.all) * 100) : 0} tone="coral" />
      <PulseRow label="Stale" pct={counts.all ? Math.round((counts.stale / counts.all) * 100) : 0} tone="amber" />
      <PulseRow label="Quiet" pct={counts.all ? Math.round((counts.quiet / counts.all) * 100) : 0} tone="neutral" />
    </div>
  );
}

function PulseRow({ label, pct, tone }: { label: string; pct: number; tone: "coral" | "teal" | "amber" | "neutral" }) {
  const fill = {
    coral: "bg-coral-400",
    teal: "bg-teal-400",
    amber: "bg-amber",
    neutral: "bg-white/30",
  }[tone];
  return (
    <div>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-cream-dim">{label}</span>
        <span className="font-mono text-cream">{pct}%</span>
      </div>
      <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
        <div className={`h-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function buildSynthesis(
  properties: PropertyCard[],
  counts: { hot: number; quiet: number; stale: number; noBov: number },
): string {
  const total = properties.length;
  if (total === 0) return "";
  const bits: string[] = [];
  if (counts.hot > 0) bits.push(`${counts.hot} need a response today`);
  if (counts.stale > 0) bits.push(`${counts.stale} stale 14+ days`);
  else if (counts.quiet > 0) bits.push(`${counts.quiet} quiet 12+ days`);
  if (counts.noBov > 0) bits.push(`${counts.noBov} missing a current valuation`);
  if (bits.length === 0) return `${total} asset${total === 1 ? "" : "s"} active. No urgent triage signals.`;
  return `Of ${total} asset${total === 1 ? "" : "s"}, ${bits.join(", ")}.`;
}

function buildInsights(properties: PropertyCard[]): InsightItem[] {
  const out: InsightItem[] = [];

  // Highest-priority single asset (deserves a callout)
  const top = [...properties].sort((a, b) => b.priorityScore - a.priorityScore)[0];
  if (top && top.priorityScore >= 3 && top.nextAction) {
    out.push({
      id: `top-${top.id}`,
      confidence: 100,
      headline: `${top.name} — ${top.nextAction}`,
      caption: top.daysSinceTouch !== null ? `Last touched ${top.daysSinceTouch}d ago.` : "Action required.",
      href: `/cre-os/properties/${top.slug}`,
      tone: "coral",
    });
  }

  // Aggregate hot lead pressure
  const hotAssets = properties.filter((p) => p.isHot);
  const totalHot = hotAssets.reduce((s, p) => s + p.hotLeads, 0);
  if (totalHot > 0) {
    out.push({
      id: "hot-aggregate",
      confidence: 100,
      headline: `${totalHot} hot inquir${totalHot === 1 ? "y" : "ies"} across ${hotAssets.length} asset${hotAssets.length === 1 ? "" : "s"}`,
      caption: "Inbound interest the AI flagged hot. SLA target: 60 minutes.",
      href: "/cre-os/inbox",
      tone: "coral",
    });
  }

  // Stale listings → listing performance signal
  const staleAssets = properties.filter((p) => p.isStale);
  if (staleAssets.length > 0) {
    out.push({
      id: "stale-listings",
      confidence: 100,
      headline: `${staleAssets.length} listing${staleAssets.length === 1 ? "" : "s"} quiet 14+ days`,
      caption: "Worth reviewing pricing narrative or refreshing marketing.",
      tone: "amber",
    });
  }

  // Missing valuations on listed assets
  const noBov = properties.filter((p) => p.isMissingValuation);
  if (noBov.length > 0) {
    out.push({
      id: "no-bov",
      confidence: 100,
      headline: `${noBov.length} listed asset${noBov.length === 1 ? "" : "s"} without a BOV`,
      caption: "Run a valuation so the cap rate and pricing thesis are current.",
      tone: "amber",
    });
  }

  // Quiet (not stale yet) — owner update reminders
  const quietButNotStale = properties.filter((p) => p.isQuiet && !p.isStale);
  if (quietButNotStale.length > 0) {
    out.push({
      id: "owner-update",
      confidence: 100,
      headline: `${quietButNotStale.length} owner${quietButNotStale.length === 1 ? "" : "s"} due for a touch`,
      caption: "12+ days since last activity. Premium relationships expect a beat every two weeks.",
      tone: "neutral",
    });
  }

  return out.slice(0, 6);
}

function labelForBucket(b: TriageBucket): string {
  switch (b) {
    case "hot": return "Hot — unanswered inquiries";
    case "quiet": return "Quiet — 12+ days without activity";
    case "stale": return "Stale — listings 14+ days quiet";
    case "no-bov": return "Missing valuation";
    default: return "All assets";
  }
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
}
