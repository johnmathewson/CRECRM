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

type CompType = "all" | "lease" | "sale";
type SortKey = "date" | "rate" | "city" | "sqft" | "cap";
type SortDir = "asc" | "desc";

/**
 * MarketView — Market Intelligence command surface. Same shape as the other
 * CRE OS command pages: editorial header with synthesis line, KPI tiles,
 * filterable submarket table, asset-class snapshot, recent comp pulse,
 * AI-interpretive insights rail.
 */
export function MarketView({ snapshot }: { snapshot: MarketSnapshot }) {
  const [typeFilter, setTypeFilter] = useState<CompType>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const allStates = useMemo(
    () => Array.from(new Set(snapshot.submarkets.map((s) => s.state).filter(Boolean))).sort(),
    [snapshot.submarkets],
  );
  const allClasses = useMemo(
    () => Array.from(new Set(snapshot.assetClasses.map((c) => c.assetType).filter(Boolean))).sort(),
    [snapshot.assetClasses],
  );
  // City list is derived from the CURRENT state filter — no point listing
  // cities in a state you've filtered out. Sorted alphabetically.
  const allCities = useMemo(() => {
    const cities = new Set<string>();
    for (const s of snapshot.submarkets) {
      if (stateFilter === "all" || s.state === stateFilter) cities.add(s.city);
    }
    return Array.from(cities).filter(Boolean).sort();
  }, [snapshot.submarkets, stateFilter]);

  const filteredSubmarkets = useMemo(
    () => snapshot.submarkets.filter((s) =>
      (stateFilter === "all" || s.state === stateFilter) &&
      (cityFilter === "all" || s.city === cityFilter),
    ),
    [snapshot.submarkets, stateFilter, cityFilter],
  );
  const filteredClasses = useMemo(
    () => snapshot.assetClasses.filter((c) => classFilter === "all" || c.assetType === classFilter),
    [snapshot.assetClasses, classFilter],
  );

  // The full filtered comp set — drives both the comp browser table and
  // the CSV export. Stays sorted by the active sort key/direction.
  const filteredComps = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = snapshot.allComps.filter((c) => {
      if (typeFilter !== "all" && c.type !== typeFilter) return false;
      if (stateFilter !== "all" && c.state !== stateFilter) return false;
      if (cityFilter !== "all" && c.city !== cityFilter) return false;
      if (classFilter !== "all" && c.assetType !== classFilter) return false;
      if (term) {
        const hay = [c.address, c.city, c.state, c.assetType, c.notes]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "rate":  return ((a.rate ?? 0) - (b.rate ?? 0)) * dir;
        case "city":  return (a.city || "").localeCompare(b.city || "") * dir;
        case "sqft":  return ((a.sqft ?? 0) - (b.sqft ?? 0)) * dir;
        case "cap":   return ((a.capRate ?? 0) - (b.capRate ?? 0)) * dir;
        case "date":
        default:      return (new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime()) * dir;
      }
    });
    return list;
  }, [snapshot.allComps, typeFilter, stateFilter, cityFilter, classFilter, search, sortKey, sortDir]);

  const filtersActive = typeFilter !== "all" || stateFilter !== "all" || cityFilter !== "all" || classFilter !== "all" || search.trim() !== "";

  function clearFilters() {
    setTypeFilter("all");
    setStateFilter("all");
    setCityFilter("all");
    setClassFilter("all");
    setSearch("");
  }
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "date" ? "desc" : "asc"); }
  }
  function exportCsv() {
    const rows = filteredComps;
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    const parts = [typeFilter, stateFilter, cityFilter, classFilter].filter((v) => v !== "all").join("-").replace(/\s+/g, "_") || "all";
    a.href = url;
    a.download = `market-comps-${parts}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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
          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CommandStat label="Comps total" value={(snapshot.totals.leaseComps + snapshot.totals.saleComps).toLocaleString()} caption={`${snapshot.totals.leaseComps} lease · ${snapshot.totals.saleComps} sale`} />
            <CommandStat label="Submarkets covered" value={snapshot.totals.submarkets.toString()} caption="Cities with at least one comp" />
            <CommandStat label="Portfolio median rent" value={fmtRate(snapshot.totals.medianRentAcrossPortfolio)} caption="$/SF/yr · all asset types" />
            <CommandStat label="Portfolio median cap" value={fmtCap(snapshot.totals.medianCapRateAcrossPortfolio)} caption="Median across sale comps" />
          </div>
        </header>

        {/* Filters — control the asset-class snapshot, submarket leaderboard,
            AND the comp browser at the bottom. Type filter (all/lease/sale)
            comes first since it's the most common slice. */}
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="Type"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as CompType)}
            options={["all", "lease", "sale"]}
            displayMap={{ all: "All", lease: "Lease", sale: "Sale" }}
          />
          <FilterSelect
            label="State"
            value={stateFilter}
            onChange={(v) => {
              setStateFilter(v);
              // If the picked city no longer belongs to the state, reset it.
              setCityFilter("all");
            }}
            options={["all", ...allStates]}
          />
          <FilterSelect
            label="City"
            value={cityFilter}
            onChange={setCityFilter}
            options={["all", ...allCities]}
          />
          <FilterSelect label="Asset class" value={classFilter} onChange={setClassFilter} options={["all", ...allClasses]} />
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Search</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Address, notes…"
              className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-[12px] text-cream font-body outline-none focus:border-coral-400/40 transition-colors min-w-[180px]"
            />
          </div>
          {filtersActive && (
            <button
              onClick={clearFilters}
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

        {/* Comp browser — full filtered comp set. Replaces the old 12-row
            "recent pulse"; broker can now drill from the aggregates above
            into specific rows, sort by any column, and export the current
            filtered set as CSV. */}
        <section>
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div>
              <Eyebrow tone="coral" num={3}>Comp browser</Eyebrow>
              <p className="mt-1 font-body text-[11px] text-cream-subtle">
                Sort, filter, and export the comps matching your selection above.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-cream-subtle">
                {filteredComps.length.toLocaleString()} of {snapshot.allComps.length.toLocaleString()} comps
              </span>
              <button
                onClick={exportCsv}
                disabled={filteredComps.length === 0}
                className="px-3 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={filteredComps.length === 0 ? "No comps to export" : `Download ${filteredComps.length} comp${filteredComps.length === 1 ? "" : "s"} as CSV`}
              >
                Export CSV
              </button>
            </div>
          </div>
          <CompBrowser
            rows={filteredComps}
            sortKey={sortKey}
            sortDir={sortDir}
            onToggleSort={toggleSort}
          />
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
  displayMap,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** Optional value→label map. Defaults: 'all' → 'All', everything else → as-is. */
  displayMap?: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-[12px] text-cream font-body outline-none focus:border-coral-400/40 transition-colors min-w-[120px]"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-steward-base">
            {displayMap?.[o] ?? (o === "all" ? "All" : o)}
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

/**
 * CompBrowser — sortable, scrollable table of every comp matching the
 * current filter set. Caps the visible rows to keep the DOM lean; a
 * footer reveals the rest as the broker scrolls. The Export CSV button
 * (in the parent) downloads the full filtered set regardless of scroll
 * position.
 */
function CompBrowser({
  rows,
  sortKey,
  sortDir,
  onToggleSort,
}: {
  rows: CompPulseRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onToggleSort: (key: SortKey) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(50);
  const visible = rows.slice(0, visibleCount);

  if (rows.length === 0) {
    return (
      <Panel>
        <p className="font-body text-[13px] text-cream-subtle py-6 text-center">
          No comps match the current filters. Try clearing one of them.
        </p>
      </Panel>
    );
  }

  return (
    <div className="bg-steward-mid/30 border border-white/[0.05] rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] font-body">
          <thead>
            <tr className="text-cream-subtle text-left bg-black/10">
              <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3">Type</th>
              <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3">Address</th>
              <SortableTh label="City" active={sortKey === "city"} dir={sortDir} onClick={() => onToggleSort("city")} />
              <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3">Asset</th>
              <SortableTh label="Rate" active={sortKey === "rate"} dir={sortDir} onClick={() => onToggleSort("rate")} align="right" />
              <SortableTh label="Cap" active={sortKey === "cap"} dir={sortDir} onClick={() => onToggleSort("cap")} align="right" />
              <SortableTh label="SF" active={sortKey === "sqft"} dir={sortDir} onClick={() => onToggleSort("sqft")} align="right" />
              <SortableTh label="Date" active={sortKey === "date"} dir={sortDir} onClick={() => onToggleSort("date")} align="right" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <StatusBadge size="xs" tone={r.type === "lease" ? "teal" : "coral"}>{r.type}</StatusBadge>
                </td>
                <td className="px-3 py-2.5 max-w-[280px]">
                  <div className="font-heading text-cream font-medium truncate" title={r.address}>{r.address}</div>
                  {r.notes && (
                    <div className="font-body text-[10px] text-cream-subtle truncate" title={r.notes}>{r.notes}</div>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-body text-cream-dim truncate">{r.city}</div>
                  <div className="font-mono text-[10px] text-cream-subtle">{r.state}</div>
                </td>
                <td className="px-3 py-2.5 font-mono text-[10px] text-cream-subtle">
                  {r.assetType || "—"}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono ${r.type === "lease" ? "text-teal-300" : "text-coral-300"}`}>
                  {r.rate === null ? "—" : r.type === "lease" ? `${fmtRate(r.rate)}/SF` : fmtPpsf(r.rate)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{fmtCap(r.capRate)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-cream-dim">
                  {r.sqft ? r.sqft.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-[10px] text-cream-subtle whitespace-nowrap">
                  {r.when}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* "Show more" expansion when the filtered set has more rows than we
          rendered. Keeps the initial paint snappy on broad filters. */}
      {rows.length > visibleCount && (
        <div className="border-t border-white/[0.06] px-3 py-2 flex items-center justify-between bg-black/10">
          <span className="font-mono text-[10px] text-cream-subtle">
            Showing {visibleCount} of {rows.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setVisibleCount((n) => n + 50)}
              className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300"
            >
              Show 50 more
            </button>
            <button
              onClick={() => setVisibleCount(rows.length)}
              className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream"
            >
              Show all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={`font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 ${align === "right" ? "text-right" : ""}`}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors ${active ? "text-coral-300" : "text-cream-subtle hover:text-cream"}`}
      >
        {label}
        {active && <span className="font-mono text-[8px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

/**
 * Build a CSV string from a list of comps. Uses standard escaping (quote
 * fields containing commas, quotes, or newlines; double internal quotes).
 * Cap rate stored as decimal (0.075) is converted to percent (7.50%) for
 * spreadsheet readability. Date is the raw ISO string.
 */
function buildCsv(rows: CompPulseRow[]): string {
  const headers = ["Type", "Address", "City", "State", "Asset Type", "Rate", "Rate Unit", "Cap Rate %", "SqFt", "Date", "Notes"];
  const escape = (v: string) => {
    if (v.includes(",") || v.includes("\"") || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) {
    const rateUnit = r.type === "lease" ? "$/SF/yr" : "$/SF";
    const rate = r.rate === null ? "" : r.rate.toFixed(2);
    const cap = r.capRate === null ? "" : (r.capRate * 100).toFixed(2);
    const sqft = r.sqft === null ? "" : String(r.sqft);
    const fields = [
      r.type,
      r.address ?? "",
      r.city ?? "",
      r.state ?? "",
      r.assetType ?? "",
      rate,
      rateUnit,
      cap,
      sqft,
      r.date ?? "",
      r.notes ?? "",
    ].map((v) => escape(String(v)));
    lines.push(fields.join(","));
  }
  return lines.join("\n");
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
