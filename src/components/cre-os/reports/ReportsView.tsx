"use client";

import { Fragment, useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type {
  ReportSnapshot,
  PipelineForecastRow,
  StageRollupRow,
  StageDealPreview,
  ClosedMonthRow,
  LeadWeekRow,
  LeadSourceRow,
  ListingReachRow,
} from "@/lib/cre-os/report-queries";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};
const fmtPct = (n: number | null) => (n === null ? "—" : Math.round(n) + "%");

/**
 * ReportsView — analytics command surface. Same layered structure as
 * Properties / Pipeline / Market: command header → section sweep →
 * insights rail. Charts are hand-rolled SVG bars to keep the bundle
 * tight and visually consistent with the rest of CRE OS.
 */
export function ReportsView({ snapshot }: { snapshot: ReportSnapshot }) {
  const t = snapshot.totals;

  // Derived numbers used in multiple places
  const leadsTrend = useMemo(() => {
    if (t.leadsLastMonth === 0) return null;
    return Math.round(((t.leadsThisMonth - t.leadsLastMonth) / t.leadsLastMonth) * 100);
  }, [t.leadsThisMonth, t.leadsLastMonth]);

  // ── Right rail ─────────────────────────────────────────────────────────
  const rail: RailSection[] = [
    {
      eyebrow: "At a glance",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Pipeline value" value={fmtMoney(t.pipelineValue)} />
          <RailStat label="Weighted" value={fmtMoney(t.weightedValue)} />
          <RailStat label="This-quarter expected" value={fmtMoney(t.expectedThisQuarter)} />
          <RailStat label="YTD won · count" value={t.wonYtdCount.toString()} />
          <RailStat label="YTD won · volume" value={fmtMoney(t.wonYtdVolume)} />
          <RailStat label="Leads · this month" value={t.leadsThisMonth.toString()} />
          <RailStat label="Active listings" value={t.activeListings.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "What stands out",
      insights: buildInsights(snapshot, leadsTrend),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <a
            href="/cre-os/pipeline"
            className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
          >
            Open pipeline →
          </a>
          <a
            href="/cre-os/market"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            Browse comps →
          </a>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Export report · CSV <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        {/* Header */}
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="coral">Reports · Analytics</Eyebrow>
            <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Reports &amp; analytics</h1>
            <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
              {snapshot.synthesis}
            </p>
            {/* Two paired KPI rows so it's easy to read:
                  Top   — what's in flight (active pipeline, gross + weighted)
                  Bottom — what's been earned (closed YTD, gross volume + actual commission)
                Earned YTD is the headline coral number — that's "what I've banked." */}
            <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
              <CommandStat label="Pipeline value" value={fmtMoney(t.pipelineValue)} caption={`${t.activeDeals} active · gross`} />
              <CommandStat label="Weighted commission" value={fmtMoney(t.weightedValue)} caption="Probability-adjusted" />
              <CommandStat label="Earned YTD" value={fmtMoney(t.earnedYtd)} caption={`Commission · ${t.wonYtdCount} closed`} accent />
              <CommandStat label="Closed volume YTD" value={fmtMoney(t.wonYtdVolume)} caption="Gross sales price" />
            </div>
            <div className="mt-2 font-mono text-[10px] text-cream-subtle">
              <span className="text-coral-300">{fmtMoney(t.expectedThisQuarter)}</span> in weighted commission expected to close this quarter.
            </div>
          </div>
          {/* PDF export — opens the print route in a new tab. */}
          <a
            href="/print/reports"
            target="_blank"
            rel="noreferrer"
            className="shrink-0 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
            title="Branded one-pager — opens in a new tab; save as PDF from the print dialog."
          >
            Export PDF
          </a>
        </header>

        {/* ── 1. Pipeline forecast ──────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <Eyebrow tone="coral" num={1}>Pipeline forecast</Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">Active deals by expected close · next 6 months</span>
          </div>
          <ForecastChart rows={snapshot.forecast} />
        </section>

        {/* ── 2. Stage rollup ───────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <Eyebrow tone="coral" num={2}>Stage rollup</Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">Active deals by current pipeline stage</span>
          </div>
          <StageTable rows={snapshot.stageRollup} />
        </section>

        {/* ── 3. Closed YTD ─────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <Eyebrow tone="teal" num={3}>Closed · last 12 months</Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">
              {t.wonYtdCount} closed YTD · {fmtMoney(t.wonYtdVolume)} volume
            </span>
          </div>
          <ClosedChart rows={snapshot.closedByMonth} />
        </section>

        {/* ── 4. Lead intake ────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <Eyebrow tone="coral" num={4}>Lead intake</Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">Last 8 weeks</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <LeadsByWeekChart rows={snapshot.leadsByWeek} />
            </div>
            <div>
              <LeadsBySource rows={snapshot.leadsBySource} />
            </div>
          </div>
        </section>

        {/* ── 5. Listing performance ────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <Eyebrow tone="coral" num={5}>Listing performance · last 7 days</Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">
              {snapshot.listingReach.length} active listing{snapshot.listingReach.length === 1 ? "" : "s"}
            </span>
          </div>
          <ListingReachTable rows={snapshot.listingReach} />
        </section>
      </div>
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function CommandStat({ label, value, caption, accent }: { label: string; value: string; caption?: string; accent?: boolean }) {
  return (
    <div className={`rounded border px-4 py-3 ${accent ? "border-coral-400/30 bg-coral-400/[0.04]" : "border-white/[0.05] bg-steward-mid/40"}`}>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-1 font-display font-medium text-2xl leading-none ${accent ? "text-coral-300" : "text-cream"}`}>{value}</div>
      {caption && <div className="mt-1 font-mono text-[9px] text-cream-subtle">{caption}</div>}
    </div>
  );
}

function ForecastChart({ rows }: { rows: PipelineForecastRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.pipelineValue));
  const totalGross = rows.reduce((s, r) => s + r.pipelineValue, 0);
  const totalWeighted = rows.reduce((s, r) => s + r.weightedValue, 0);

  if (totalGross === 0) {
    return (
      <Panel>
        <p className="font-body text-[13px] text-cream-subtle py-6 text-center">
          No active deals have an expected close in the next 6 months. Set expected close dates on deals to see the forecast.
        </p>
      </Panel>
    );
  }

  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 p-4">
      <div className="flex items-end gap-3 min-h-[180px]">
        {rows.map((r) => {
          const grossPct = (r.pipelineValue / max) * 100;
          const weightedPct = max > 0 ? (r.weightedValue / max) * 100 : 0;
          return (
            <div key={r.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="font-mono text-[10px] text-cream-dim">{r.activeCount > 0 ? fmtMoney(r.weightedValue) : ""}</div>
              <div className="w-full relative" style={{ height: 140 }}>
                {/* Gross bar (faded coral) — total pipeline */}
                <div
                  className="absolute bottom-0 left-0 right-0 bg-coral-400/25 rounded-t"
                  style={{ height: `${grossPct}%`, transition: "height 0.4s" }}
                  title={`${r.activeCount} deal${r.activeCount === 1 ? "" : "s"} · ${fmtMoney(r.pipelineValue)} pipeline`}
                />
                {/* Weighted bar (solid coral) — probability-adjusted */}
                <div
                  className="absolute bottom-0 left-0 right-0 bg-coral-400 rounded-t"
                  style={{ height: `${weightedPct}%`, transition: "height 0.4s" }}
                  title={`${fmtMoney(r.weightedValue)} weighted (probability-adjusted)`}
                />
              </div>
              <div className="font-mono text-[10px] text-cream-subtle whitespace-nowrap">{r.monthLabel}</div>
              <div className="font-mono text-[9px] text-cream-subtle">{r.activeCount} deals</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between flex-wrap gap-3 font-mono text-[10px]">
        <div className="flex items-center gap-4">
          <Legend swatch="bg-coral-400" label="Weighted" value={fmtMoney(totalWeighted)} />
          <Legend swatch="bg-coral-400/25" label="Pipeline" value={fmtMoney(totalGross)} />
        </div>
        <span className="text-cream-subtle">{rows.reduce((s, r) => s + r.activeCount, 0)} deals with expected close set</span>
      </div>
    </div>
  );
}

function StageTable({ rows }: { rows: StageRollupRow[] }) {
  // Expanded-stage state — only one expanded at a time keeps the page calm.
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Panel>
        <p className="font-body text-[13px] text-cream-subtle py-6 text-center">
          No active deals to roll up. Add deals via Pipeline or by saving a BOV.
        </p>
      </Panel>
    );
  }
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 overflow-hidden">
      <table className="w-full text-[12px] font-body">
        <thead>
          <tr className="text-cream-subtle text-left bg-black/10">
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 w-8"></th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3">Stage</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 w-[200px]">Activity</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Count</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Value</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Weighted</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Avg prob</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = (r.count / maxCount) * 100;
            const isOpen = expanded === r.stage;
            return (
              <Fragment key={r.stage}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : r.stage)}
                  className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer transition-colors"
                  title={`Click to ${isOpen ? "collapse" : "see deals at this stage"}`}
                >
                  <td className="px-3 py-2.5 text-cream-subtle">
                    <span className="inline-block transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▸</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-heading text-cream font-medium">{r.stage}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                      <div className="h-full bg-coral-400/60" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-cream">{r.count}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{fmtMoney(r.totalValue)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-coral-300 font-semibold">{fmtMoney(r.weightedValue)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{fmtPct(r.avgProbability)}</td>
                </tr>
                {isOpen && (
                  <tr className="bg-black/15">
                    <td colSpan={7} className="px-3 py-3">
                      <StageDealsList deals={r.deals} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StageDealsList({ deals }: { deals: StageDealPreview[] }) {
  if (deals.length === 0) {
    return <p className="font-body text-[11px] text-cream-subtle italic px-3 py-2">No deals at this stage.</p>;
  }
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle px-2">
        Deals at this stage · sorted by days stalled (longest first)
      </div>
      {deals.map((d) => {
        const subtitle = [d.propertyName, d.expectedClose ? `close ${d.expectedClose}` : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <a
            key={d.id}
            href={`/cre-os/pipeline/${d.id}`}
            className="flex items-center justify-between gap-3 px-2.5 py-2 rounded border border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.06] transition-colors group"
          >
            <div className="min-w-0 flex-1">
              <div className="font-heading text-[12px] text-cream group-hover:text-coral-300 transition-colors truncate">
                {d.dealName || d.propertyName || "Untitled deal"}
              </div>
              {subtitle && (
                <div className="font-mono text-[10px] text-cream-subtle truncate">{subtitle}</div>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-3 font-mono text-[10px]">
              <span className="text-cream-dim">{fmtMoney(d.price ?? 0)}</span>
              <span className="text-coral-300 font-semibold">{fmtMoney(d.weightedCommission ?? 0)}</span>
              <span className="text-cream-subtle w-12 text-right">
                {d.daysInStage === null ? "—" : `${d.daysInStage}d`}
              </span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function ClosedChart({ rows }: { rows: ClosedMonthRow[] }) {
  const maxVolume = Math.max(1, ...rows.map((r) => r.volume));
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const totalVolume = rows.reduce((s, r) => s + r.volume, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);

  if (totalCount === 0) {
    return (
      <Panel>
        <p className="font-body text-[13px] text-cream-subtle py-6 text-center">
          No closed deals in the last 12 months. Mark a deal won from the deal workspace and it'll roll up here.
        </p>
      </Panel>
    );
  }

  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 p-4">
      <div className="flex items-end gap-2 min-h-[160px]">
        {rows.map((r) => {
          const pct = r.volume === 0 ? 2 : Math.max(4, (r.volume / maxVolume) * 120);
          return (
            <div key={r.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="font-mono text-[9px] text-cream-dim">{r.count > 0 ? fmtMoney(r.volume) : ""}</div>
              <div
                className="w-full bg-teal-400/70 rounded-t"
                style={{ height: pct, transition: "height 0.4s" }}
                title={`${r.count} closed · ${fmtMoney(r.volume)} volume · ${fmtMoney(r.commission)} commission`}
              />
              <div className="font-mono text-[10px] text-cream-subtle whitespace-nowrap">{r.monthLabel}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between flex-wrap gap-3 font-mono text-[10px] text-cream-dim">
        <div className="flex gap-4">
          <Legend swatch="bg-teal-400/70" label="Closed volume" value={fmtMoney(totalVolume)} />
          <span><span className="text-cream-subtle">Commission earned:</span> <span className="text-cream font-semibold">{fmtMoney(totalCommission)}</span></span>
        </div>
        <span className="text-cream-subtle">{totalCount} deal{totalCount === 1 ? "" : "s"} closed</span>
      </div>
    </div>
  );
}

function LeadsByWeekChart({ rows }: { rows: LeadWeekRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 p-4 h-full flex flex-col">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle mb-3">Leads per week</div>
      <div className="flex items-end gap-1.5 flex-1 min-h-[120px]">
        {rows.map((r, i) => {
          const isLatest = i === rows.length - 1;
          const pct = r.count === 0 ? 2 : Math.max(4, (r.count / max) * 110);
          return (
            <div key={r.week} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="font-mono text-[9px] text-cream-dim h-3">{r.count > 0 ? r.count : ""}</div>
              <div
                className={`w-full rounded-t ${isLatest ? "bg-coral-400" : "bg-coral-400/60"}`}
                style={{ height: pct, transition: "height 0.4s" }}
                title={`Week of ${r.weekStart}: ${r.count} leads`}
              />
              <div className="font-mono text-[9px] text-cream-subtle whitespace-nowrap">{r.weekLabel}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 pt-2 border-t border-white/[0.04] font-mono text-[10px] text-cream-subtle">
        {total} leads in the last 8 weeks
      </div>
    </div>
  );
}

function LeadsBySource({ rows }: { rows: LeadSourceRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) {
    return (
      <Panel>
        <p className="font-body text-[13px] text-cream-subtle py-4 text-center">No leads in window.</p>
      </Panel>
    );
  }
  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 p-4">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle mb-3">By source</div>
      <div className="space-y-2">
        {rows.slice(0, 8).map((r) => {
          const pct = (r.count / max) * 100;
          return (
            <div key={r.source} className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-cream-dim w-20 truncate" title={r.source}>{r.source || "—"}</span>
              <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                <div className="h-full bg-coral-400/60" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-mono text-[11px] text-cream w-8 text-right">{r.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ListingReachTable({ rows }: { rows: ListingReachRow[] }) {
  if (rows.length === 0) {
    return (
      <Panel>
        <p className="font-body text-[13px] text-cream-subtle py-6 text-center">
          No active listings. Add a property at status "listed" to see its reach roll up here.
        </p>
      </Panel>
    );
  }
  const maxReach = Math.max(1, ...rows.map((r) => r.reach7d));
  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 overflow-hidden">
      <table className="w-full text-[12px] font-body">
        <thead>
          <tr className="text-cream-subtle text-left bg-black/10">
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3">Listing</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 w-[140px]">Reach (7d)</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Inquiries</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">OMs</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">NDAs</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Conv/1k</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">DOM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = (r.reach7d / maxReach) * 100;
            return (
              <tr key={r.propertyId} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  {r.slug ? (
                    <a href={`/cre-os/properties/${r.slug}`} className="block group">
                      <span className="font-heading text-cream font-medium group-hover:text-coral-300 transition-colors truncate block">
                        {r.headline || r.name}
                      </span>
                      <span className="font-mono text-[10px] text-cream-subtle">
                        {[r.city, r.state].filter(Boolean).join(", ")}
                        {r.status && <span className="ml-2"><StatusBadge tone="coral" size="xs">{r.status.replace("_", " ")}</StatusBadge></span>}
                      </span>
                    </a>
                  ) : (
                    <span className="font-heading text-cream-dim">{r.name}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                      <div className="h-full bg-coral-400/60" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-cream w-12 text-right">{r.reach7d.toLocaleString()}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-coral-300 font-semibold">{r.inquiries7d}</td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{r.omDownloads7d}</td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{r.ndaSignatures7d}</td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-dim">
                  {r.conversionPer1k === null ? "—" : r.conversionPer1k}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-subtle">
                  {r.daysOnMarket === null ? "—" : `${r.daysOnMarket}d`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${swatch}`} />
      <span className="text-cream-subtle">{label}:</span>
      <span className="text-cream font-semibold">{value}</span>
    </span>
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

// ── Insights generation ───────────────────────────────────────────────────
function buildInsights(snapshot: ReportSnapshot, leadsTrend: number | null) {
  const out: { id: string; confidence: number; headline: string; caption: string; tone: "coral" | "teal" | "amber" | "neutral" }[] = [];

  // Quarter close concentration
  const t = snapshot.totals;
  if (t.expectedThisQuarter > 0 && t.weightedValue > 0) {
    const pct = Math.round((t.expectedThisQuarter / t.weightedValue) * 100);
    if (pct >= 50) {
      out.push({
        id: "qtr-concentration",
        confidence: 95,
        headline: `${pct}% of weighted pipeline due this quarter`,
        caption: `${fmtMoney(t.expectedThisQuarter)} expected to close before quarter-end. Make sure you're babysitting these.`,
        tone: "coral",
      });
    }
  }

  // Lead trend
  if (leadsTrend !== null) {
    if (leadsTrend >= 25) {
      out.push({
        id: "lead-spike",
        confidence: 90,
        headline: `Lead intake up ${leadsTrend}%`,
        caption: `${t.leadsThisMonth} this month vs. ${t.leadsLastMonth} last. Triage capacity is the bottleneck — keep the inbox clean.`,
        tone: "teal",
      });
    } else if (leadsTrend <= -25) {
      out.push({
        id: "lead-drop",
        confidence: 90,
        headline: `Lead intake down ${Math.abs(leadsTrend)}%`,
        caption: `${t.leadsThisMonth} this month vs. ${t.leadsLastMonth} last. Worth checking listing performance and outreach cadence.`,
        tone: "amber",
      });
    }
  }

  // Listing with high reach but no inquiries (pricing/positioning issue)
  const dud = [...snapshot.listingReach]
    .filter((r) => r.reach7d >= 50 && r.inquiries7d === 0)
    .sort((a, b) => b.reach7d - a.reach7d)[0];
  if (dud) {
    out.push({
      id: "high-reach-no-inquiries",
      confidence: 85,
      headline: `${dud.name}: traffic but no inquiries`,
      caption: `${dud.reach7d.toLocaleString()} views, 0 inquiries this week. Could be pricing, photos, or positioning.`,
      tone: "amber",
    });
  }

  // Best converter
  const hot = [...snapshot.listingReach]
    .filter((r) => r.conversionPer1k !== null && r.conversionPer1k > 0)
    .sort((a, b) => (b.conversionPer1k ?? 0) - (a.conversionPer1k ?? 0))[0];
  if (hot && (hot.conversionPer1k ?? 0) >= 5) {
    out.push({
      id: "best-converter",
      confidence: 80,
      headline: `${hot.name}: ${hot.conversionPer1k} per 1k converting`,
      caption: `${hot.inquiries7d} inquiries on ${hot.reach7d.toLocaleString()} views this week. The market wants this asset.`,
      tone: "teal",
    });
  }

  // Stale stage warning
  const stuck = snapshot.stageRollup.find((s) =>
    ["LOI", "Underwriting", "Due Diligence", "Financing"].includes(s.stage) && s.count >= 2
  );
  if (stuck) {
    out.push({
      id: "stuck-mid-pipeline",
      confidence: 80,
      headline: `${stuck.count} deals at ${stuck.stage}`,
      caption: `Mid-pipeline cluster — these are the ones that pay if you push them. Don't let any drift.`,
      tone: "neutral",
    });
  }

  if (out.length === 0) {
    out.push({
      id: "calm",
      confidence: 100,
      headline: "Numbers are calm",
      caption: "No anomalies vs. baseline. Good time to push outreach or backfill notes.",
      tone: "neutral",
    });
  }

  return out.slice(0, 5);
}
