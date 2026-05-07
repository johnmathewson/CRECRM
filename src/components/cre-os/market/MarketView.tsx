"use client";

import { useState, useMemo } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { MarketSnapshot, SubmarketRow, AssetClassSnapshot, CompPulseRow } from "@/lib/cre-os/market-queries";

const fmtRate = (n: number | null) => n === null ? "—" : "$" + n.toFixed(2);
const fmtPpsf = (n: number | null) => n === null ? "—" : "$" + n.toFixed(0);
const fmtCap = (n: number | null) => n === null ? "—" : (n * 100).toFixed(2) + "%";

/**
 * MarketView — Market Intelligence command surface. Same shape as the other
 * CRE OS command pages: editorial header with synthesis line, KPI tiles,
 * filterable submarket table, asset-class snapshot, recent comp pulse,
 * AI-interpretive insights rail.
 */
export function MarketView({ snapshot }: { snapshot: MarketSnapshot }) {
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");

  const allStates = useMemo(
    () => Array.from(new Set(snapshot.submarkets.map((s) => s.state).filter(Boolean))).sort(),
    [snapshot.submarkets],
  );
  const allClasses = useMemo(
    () => Array.from(new Set(snapshot.assetClasses.map((c) => c.assetType).filter(Boolean))).sort(),
    [snapshot.assetClasses],
  );

  const filteredSubmarkets = useMemo(
    () => snapshot.submarkets.filter((s) => stateFilter === "all" || s.state === stateFilter),
    [snapshot.submarkets, stateFilter],
  );
  const filteredClasses = useMemo(
    () => snapshot.assetClasses.filter((c) => classFilter === "all" || c.assetType === classFilter),
    [snapshot.assetClasses, classFilter],
  );
  const filteredRecent = useMemo(
    () => snapshot.recentComps.filter((c) =>
      (stateFilter === "all" || c.state === stateFilter) &&
      (classFilter === "all" || c.assetType === classFilter),
    ),
    [snapshot.recentComps, stateFilter, classFilter],
  );

  // ── Right rail ────────────────────────────────────────────────────────
  const rail: RailSection[] = [
    {
      eyebrow: "Market pulse",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Lease comps" value={snapshot.totals.leaseComps.toLocaleString()} />
          <RailStat label="Sale comps" value={snapshot.totals.saleComps.toLocaleString()} />
          <RailStat label="Submarkets" value={snapshot.totals.submarkets.toString()} />
          <RailStat label="Median rent" value={fmtRate(snapshot.totals.medianRentAcrossPortfolio) + (snapshot.totals.medianRentAcrossPortfolio !== null ? "/SF" : "")} />
          <RailStat label="Median cap" value={fmtCap(snapshot.totals.medianCapRateAcrossPortfolio)} />
        </div>
      ),
    },
    {
      eyebrow: "What stands out",
      insights: buildInsights(snapshot),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <a href="/comps" className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors">
            Browse comps database
          </a>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Import comps · CSV <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Submarket heatmap <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        {/* Header */}
        <header>
          <Eyebrow tone="coral">Market · Intelligence</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Market intelligence</h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            {snapshot.synthesis}
          </p>
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <CommandStat label="Comps total" value={(snapshot.totals.leaseComps + snapshot.totals.saleComps).toLocaleString()} caption={`${snapshot.totals.leaseComps} lease · ${snapshot.totals.saleComps} sale`} />
            <CommandStat label="Submarkets covered" value={snapshot.totals.submarkets.toString()} caption="Cities with at least one comp" />
            <CommandStat label="Portfolio median rent" value={fmtRate(snapshot.totals.medianRentAcrossPortfolio)} caption="$/SF/yr · all asset types" />
            <CommandStat label="Portfolio median cap" value={fmtCap(snapshot.totals.medianCapRateAcrossPortfolio)} caption="Median across sale comps" />
          </div>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect label="State" value={stateFilter} onChange={setStateFilter} options={["all", ...allStates]} />
          <FilterSelect label="Asset class" value={classFilter} onChange={setClassFilter} options={["all", ...allClasses]} />
          {(stateFilter !== "all" || classFilter !== "all") && (
            <button
              onClick={() => { setStateFilter("all"); setClassFilter("all"); }}
              className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300 self-end pb-2"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Asset class snapshot */}
        <section>
          <Eyebrow tone="coral" num={1}>Asset-class snapshot</Eyebrow>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredClasses.map((c) => <AssetClassCard key={c.assetType} cls={c} />)}
            {filteredClasses.length === 0 && (
              <Panel><p className="font-body text-[13px] text-cream-subtle py-4 text-center">No data for this filter.</p></Panel>
            )}
          </div>
        </section>

        {/* Submarket leaderboard */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <Eyebrow tone="coral" num={2}>Submarket activity</Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">{filteredSubmarkets.length} submarket{filteredSubmarkets.length === 1 ? "" : "s"}</span>
          </div>
          <SubmarketTable rows={filteredSubmarkets} />
        </section>

        {/* Recent comps pulse */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <Eyebrow tone="coral" num={3}>Recent comp pulse</Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">Most recent {Math.min(filteredRecent.length, 12)}</span>
          </div>
          <CompPulse rows={filteredRecent.slice(0, 12)} />
        </section>
      </div>
    </AppShell>
  );
}

// ── Components ────────────────────────────────────────────────────────────
function CommandStat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="bg-steward-mid/40 border border-white/[0.05] rounded-md p-4">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-display font-medium text-2xl text-cream leading-none">{value}</div>
      {caption && <div className="mt-1 font-mono text-[9px] text-cream-subtle">{caption}</div>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-[12px] text-cream font-body outline-none focus:border-coral-400/40 transition-colors"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-steward-base">
            {o === "all" ? "All" : o}
          </option>
        ))}
      </select>
    </div>
  );
}

function AssetClassCard({ cls }: { cls: AssetClassSnapshot }) {
  return (
    <div className="bg-steward-mid/40 border border-white/[0.05] rounded-md p-4">
      <div className="flex items-baseline justify-between">
        <Eyebrow tone="coral">{cls.assetType.toUpperCase()}</Eyebrow>
        <span className="font-mono text-[10px] text-cream-subtle">
          {cls.leaseCount}L · {cls.saleCount}S
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat label="Median rent" value={cls.medianRent !== null ? `${fmtRate(cls.medianRent)}/SF` : "—"} accent />
        <Stat label="Median sale $/SF" value={fmtPpsf(cls.medianSalePsf)} />
        <Stat label="Median cap" value={fmtCap(cls.medianCapRate)} />
        <Stat
          label="Rent spread"
          value={cls.rentRange ? `${fmtRate(cls.rentRange.low)}–${fmtRate(cls.rentRange.high)}` : "—"}
        />
      </div>
    </div>
  );
}

function SubmarketTable({ rows }: { rows: SubmarketRow[] }) {
  if (rows.length === 0) {
    return <Panel><p className="font-body text-[13px] text-cream-subtle py-6 text-center">No submarkets match this filter.</p></Panel>;
  }
  const maxActivity = Math.max(...rows.map((r) => r.leaseCount + r.saleCount), 1);
  return (
    <div className="overflow-x-auto -mx-1 bg-steward-mid/30 border border-white/[0.05] rounded-md">
      <table className="w-full text-[12px] font-body">
        <thead>
          <tr className="text-cream-subtle text-left bg-black/10">
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-3 pt-3 px-3">Submarket</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-3 pt-3 px-3">Activity</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-3 pt-3 px-3 text-right">Median rent</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-3 pt-3 px-3 text-right">Sale $/SF</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-3 pt-3 px-3 text-right">Cap</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-3 pt-3 px-3 text-right">Counts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = ((r.leaseCount + r.saleCount) / maxActivity) * 100;
            return (
              <tr key={`${r.city}-${r.state}`} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <div className="font-heading text-cream font-medium truncate">{r.city}</div>
                  <div className="font-mono text-[10px] text-cream-subtle">{r.state}</div>
                </td>
                <td className="px-3 py-2.5 min-w-[120px]">
                  <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                    <div className="h-full bg-coral-400/60" style={{ width: `${pct}%` }} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-coral-300">
                  {r.medianRent !== null ? `${fmtRate(r.medianRent)}/SF` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{fmtPpsf(r.medianSalePsf)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{fmtCap(r.medianCapRate)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-subtle text-[10px]">
                  {r.leaseCount}L · {r.saleCount}S
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompPulse({ rows }: { rows: CompPulseRow[] }) {
  if (rows.length === 0) {
    return <Panel><p className="font-body text-[13px] text-cream-subtle py-6 text-center">No recent comps for this filter.</p></Panel>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-baseline justify-between gap-3 p-3 bg-white/[0.02] border border-white/[0.05] rounded">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <StatusBadge size="xs" tone={r.type === "lease" ? "teal" : "coral"}>{r.type}</StatusBadge>
              <span className="font-heading text-[12px] font-semibold text-cream truncate">{r.address}</span>
              <span className="font-mono text-[10px] text-cream-subtle">{r.city}, {r.state}</span>
            </div>
            {r.notes && (
              <p className="mt-1 font-body text-[11px] text-cream-dim truncate">{r.notes}</p>
            )}
          </div>
          <div className="flex items-baseline gap-3 shrink-0">
            {r.assetType && <span className="font-mono text-[10px] text-cream-subtle">{r.assetType}</span>}
            {r.sqft && <span className="font-mono text-[10px] text-cream-dim">{r.sqft.toLocaleString()} SF</span>}
            <span className={`font-display font-medium text-[13px] ${r.type === "lease" ? "text-teal-300" : "text-coral-300"}`}>
              {r.type === "lease" ? `${fmtRate(r.rate)}/SF` : fmtPpsf(r.rate)}
            </span>
            {r.capRate !== null && (
              <span className="font-mono text-[10px] text-cream-dim">{fmtCap(r.capRate)}</span>
            )}
            <span className="font-mono text-[10px] text-cream-subtle whitespace-nowrap">{r.when}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-0.5 font-mono text-[12px] ${accent ? "text-coral-300" : "text-cream"} font-medium`}>{value}</div>
    </div>
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

function buildInsights(snapshot: MarketSnapshot) {
  const out: Array<{ id: string; confidence: number; headline: string; caption: string; tone: "coral" | "teal" | "amber" | "neutral" }> = [];

  // Submarket with the most lease activity
  const topLease = [...snapshot.submarkets].sort((a, b) => b.leaseCount - a.leaseCount)[0];
  if (topLease && topLease.leaseCount >= 5 && topLease.medianRent !== null) {
    out.push({
      id: "top-leasing",
      confidence: 100,
      headline: `${topLease.city} leasing at ${fmtRate(topLease.medianRent)}/SF`,
      caption: `${topLease.leaseCount} active lease comps. Median rent benchmark for the submarket.`,
      tone: "teal",
    });
  }

  // Asset class with widest cap-rate spread (volatility signal)
  const wideCap = [...snapshot.assetClasses].filter((c) => c.capRateRange).sort((a, b) => {
    const aS = a.capRateRange ? a.capRateRange.high - a.capRateRange.low : 0;
    const bS = b.capRateRange ? b.capRateRange.high - b.capRateRange.low : 0;
    return bS - aS;
  })[0];
  if (wideCap && wideCap.capRateRange && (wideCap.capRateRange.high - wideCap.capRateRange.low) > 0.02) {
    out.push({
      id: "cap-spread",
      confidence: 100,
      headline: `${wideCap.assetType} cap spread: ${fmtCap(wideCap.capRateRange.low)} – ${fmtCap(wideCap.capRateRange.high)}`,
      caption: "Wide spread suggests pricing tension or quality variance — opportunity for arbitrage.",
      tone: "amber",
    });
  }

  // Asset class with the strongest activity
  const topClass = snapshot.assetClasses[0];
  if (topClass && (topClass.leaseCount + topClass.saleCount) >= 10) {
    out.push({
      id: "top-class",
      confidence: 100,
      headline: `${capitalize(topClass.assetType)} most active class`,
      caption: `${topClass.leaseCount} lease + ${topClass.saleCount} sale comps. Watch the median benchmark.`,
      tone: "neutral",
    });
  }

  return out.slice(0, 6);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}
