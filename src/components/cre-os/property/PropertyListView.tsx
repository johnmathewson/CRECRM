"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import { PropertyListCard } from "./PropertyListCard";
import type { PropertyCard } from "@/lib/cre-os/property-queries";

const ASSET_TYPES = ["all", "retail", "office", "industrial", "multifamily", "hospitality", "medical", "land", "mixed_use", "other"];
const STATUSES = ["all", "active", "listed", "leased", "closed", "idea", "draft"];

/**
 * PropertyListView — index page for /cre-os/properties. Search + asset/status
 * filters at the top, then a responsive grid of cards. Right rail surfaces
 * portfolio-level KPIs derived from the same dataset.
 */
export function PropertyListView({ properties }: { properties: PropertyCard[] }) {
  const [q, setQ] = useState("");
  const [assetType, setAssetType] = useState("all");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return properties.filter((p) => {
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
  }, [properties, q, assetType, status]);

  // Portfolio rollups for the rail
  const totalValue = properties.reduce((s, p) => s + (p.askingPrice ?? 0), 0);
  const totalSF = properties.reduce((s, p) => s + (p.sqft ?? 0), 0);
  const totalNoi = properties.reduce((s, p) => s + (p.noi ?? 0), 0);
  const hotLeads = properties.reduce((s, p) => s + p.hotLeads, 0);
  const tasks = properties.reduce((s, p) => s + p.openTasks, 0);
  const stale = properties.filter((p) => (p.daysSinceTouch ?? 0) > 12).length;
  const byAsset = properties.reduce((m, p) => {
    const k = p.assetType || "other";
    m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  }, new Map<string, number>());

  const rail: RailSection[] = [
    {
      eyebrow: "Portfolio rollup",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Total assets" value={properties.length.toString()} />
          <RailStat label="Total SF" value={totalSF ? totalSF.toLocaleString() : "—"} />
          <RailStat label="Aggregate value" value={fmtMoney(totalValue)} />
          <RailStat label="Aggregate NOI" value={fmtMoney(totalNoi)} />
          <RailStat label="Hot leads" value={hotLeads.toString()} />
          <RailStat label="Open tasks" value={tasks.toString()} />
          <RailStat label="Quiet 12+ days" value={stale.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "By asset type",
      children: (
        <div className="space-y-1.5">
          {Array.from(byAsset.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between text-[11px] font-body text-cream-dim">
                <span>{k.replace("_", " ")}</span>
                <span className="font-mono text-cream">{v}</span>
              </div>
            ))}
        </div>
      ),
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
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <Eyebrow tone="coral">Properties</Eyebrow>
          <h1 className="mt-1 font-display text-3xl text-cream tracking-tight">Asset inventory</h1>
          <p className="mt-1 font-body text-[13px] text-cream-dim">
            {properties.length} asset{properties.length === 1 ? "" : "s"} on the books · click any to open the workspace.
          </p>
        </div>

        {/* Filters */}
        <Panel variant="flat">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <label className="block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle mb-1">Search</label>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, address, city, asset type…"
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-[13px] text-cream placeholder:text-cream-subtle font-body outline-none focus:border-coral-400/40 focus:bg-white/[0.06] transition-colors"
              />
            </div>
            <FilterSelect label="Asset type" value={assetType} onChange={setAssetType} options={ASSET_TYPES} />
            <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUSES} />
          </div>
          <div className="mt-3 font-mono text-[10px] text-cream-subtle">
            Showing {filtered.length} of {properties.length}
          </div>
        </Panel>

        {/* Grid */}
        {filtered.length === 0 ? (
          <Panel>
            <p className="font-body text-[13px] text-cream-subtle py-8 text-center">
              No properties match. Try clearing filters.
            </p>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <PropertyListCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-[13px] text-cream font-body outline-none focus:border-coral-400/40 focus:bg-white/[0.06] transition-colors"
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

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold">{value}</span>
    </div>
  );
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
}
