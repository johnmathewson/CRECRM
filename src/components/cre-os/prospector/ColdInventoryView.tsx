"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { SendTouchDialog } from "@/components/cre-os/prospector/SendTouchDialog";
import type { ColdProperty } from "@/lib/cre-os/prospector-queries";

interface Facets {
  counties: string[];
  assetTypes: string[];
  signalFlags: string[];
}

interface FilterState {
  q?: string;
  assetType?: string;
  county?: string;
  signalFlag?: string;
}

const fmtMoney = (n: number | null) => {
  if (n == null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

export function ColdInventoryView({
  inv,
  facets,
  page,
  limit,
  filters,
}: {
  inv: { rows: ColdProperty[]; total: number };
  facets: Facets;
  page: number;
  limit: number;
  filters: FilterState;
}) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(filters.q ?? "");
  const [touchTarget, setTouchTarget] = useState<ColdProperty | null>(null);

  function applyFilter(patch: Partial<FilterState> & { page?: number }) {
    const next: Record<string, string> = {};
    const merged = { ...filters, ...patch };
    if (merged.q) next.q = merged.q;
    if (merged.assetType) next.assetType = merged.assetType;
    if (merged.county) next.county = merged.county;
    if (merged.signalFlag) next.signalFlag = merged.signalFlag;
    if (patch.page !== undefined && patch.page > 0) next.page = patch.page.toString();
    const params = new URLSearchParams(next).toString();
    router.push(`/cre-os/prospector/inventory${params ? "?" + params : ""}`);
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow tone="coral">Prospector · Cold inventory</Eyebrow>
            <Link href="/cre-os/prospector" className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream">
              ← Back to Prospector
            </Link>
            <h1 className="mt-1 font-display font-medium text-2xl text-cream">Cold inventory</h1>
            <p className="mt-2 font-heading text-[13px] text-cream-dim leading-relaxed max-w-3xl">
              All {inv.total.toLocaleString()} cold properties — mined from CoStar + PropStream, sorted by
              prospector score. Click into any property to see signals, owner, debt, and lane status.
            </p>
          </div>
        </header>

        {/* Filters */}
        <Panel eyebrow="Filter" num={1} title="Slice the universe">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">Search</label>
              <form
                onSubmit={(e) => { e.preventDefault(); applyFilter({ q: searchInput || undefined, page: 0 }); }}
              >
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="address / owner"
                  className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
                />
              </form>
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">Asset type</label>
              <select
                value={filters.assetType ?? ""}
                onChange={(e) => applyFilter({ assetType: e.target.value || undefined, page: 0 })}
                className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream"
              >
                <option value="">Any</option>
                {facets.assetTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">County</label>
              <select
                value={filters.county ?? ""}
                onChange={(e) => applyFilter({ county: e.target.value || undefined, page: 0 })}
                className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream"
              >
                <option value="">Any</option>
                {facets.counties.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">Signal flag</label>
              <select
                value={filters.signalFlag ?? ""}
                onChange={(e) => applyFilter({ signalFlag: e.target.value || undefined, page: 0 })}
                className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream"
              >
                <option value="">Any</option>
                {facets.signalFlags.map((f) => <option key={f} value={f}>{f.replace(/_/g, " ")}</option>)}
              </select>
            </div>
          </div>
        </Panel>

        {/* Table */}
        <Panel eyebrow="Inventory" num={2} title={`${inv.total.toLocaleString()} prospects`}>
          {inv.rows.length === 0 ? (
            <p className="font-body text-[12px] text-cream-subtle italic">
              No cold properties match these filters.{" "}
              {inv.total === 0 && (
                <Link href="/cre-os/settings/data-imports" className="text-coral-300 underline">
                  Upload your first export →
                </Link>
              )}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full font-body text-[11.5px]">
                <thead>
                  <tr className="text-left font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle border-b border-white/[0.05]">
                    <th className="py-2 pr-3">Property</th>
                    <th className="py-2 pr-3">Owner</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3 text-right">SF</th>
                    <th className="py-2 pr-3 text-right">Est. value</th>
                    <th className="py-2 pr-3">Signals</th>
                    <th className="py-2 pr-3">Lanes</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {inv.rows.map((p) => (
                    <tr key={p.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                      <td className="py-2.5 pr-3">
                        <div className="text-cream font-semibold truncate max-w-[24ch]">
                          {p.name ?? p.address ?? "(unnamed)"}
                        </div>
                        <div className="text-cream-subtle font-mono text-[10px]">
                          {[p.address, p.city, p.state].filter(Boolean).join(", ") || p.county || "—"}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-cream-dim truncate max-w-[20ch]">
                        {p.ownerNameRaw ?? "—"}
                        {p.ownerOutOfState && <span className="ml-1 font-mono text-[9px] text-amber">OOS</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-cream-dim">{p.assetType ?? "—"}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-cream-dim">
                        {p.sqft ? p.sqft.toLocaleString() : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums text-cream-dim">
                        {fmtMoney(p.estimatedValue)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {p.signalFlags.slice(0, 3).map((f) => (
                            <span key={f} className="font-mono text-[9px] uppercase tracking-eyebrow text-amber bg-amber/[0.08] border border-amber/30 px-1.5 py-0.5 rounded">
                              {f.replace(/_/g, " ")}
                            </span>
                          ))}
                          {p.signalFlags.length > 3 && (
                            <span className="font-mono text-[9px] text-cream-subtle">+{p.signalFlags.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        {p.activeLanes.length === 0 ? (
                          <span className="text-cream-subtle font-mono text-[9.5px]">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {p.activeLanes.map((l) => (
                              <span key={l.id} className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-300 bg-coral-400/[0.08] border border-coral-400/30 px-1.5 py-0.5 rounded">
                                {l.name.replace(/^Lane [A-Z] — /, "")}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => setTouchTarget(p)}
                          className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-coral-300 mr-3"
                        >
                          Send touch
                        </button>
                        <Link
                          href={`/cre-os/properties/${p.slug ?? p.id}`}
                          className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300 hover:text-coral-200"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {inv.total > limit && (
            <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between font-mono text-[10.5px] text-cream-subtle">
              <span>
                Showing {page * limit + 1}–{Math.min((page + 1) * limit, inv.total)} of {inv.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => applyFilter({ page: page - 1 })}
                  className="px-3 py-1 rounded border border-white/[0.08] hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ← Prev
                </button>
                <button
                  disabled={(page + 1) * limit >= inv.total}
                  onClick={() => applyFilter({ page: page + 1 })}
                  className="px-3 py-1 rounded border border-white/[0.08] hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {touchTarget && (
        <SendTouchDialog
          property={{
            id: touchTarget.id,
            name: touchTarget.name,
            address: touchTarget.address,
            ownerNameRaw: touchTarget.ownerNameRaw,
          }}
          open={!!touchTarget}
          onClose={() => setTouchTarget(null)}
        />
      )}
    </AppShell>
  );
}
