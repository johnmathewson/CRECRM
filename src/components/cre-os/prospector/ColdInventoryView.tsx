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
            <div className="space-y-1.5">
              {inv.rows.map((p) => (
                <ProspectCard
                  key={p.id}
                  prospect={p}
                  onSendTouch={() => setTouchTarget(p)}
                />
              ))}
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

// ── Prospect card ────────────────────────────────────────────────────────
// Rich row with owner identity, key signals, debt info, and quick actions.
// Replaces the prior thin table — surfaces what's actually useful for cold
// outreach decisions at a glance.

function ProspectCard({
  prospect: p,
  onSendTouch,
}: {
  prospect: ColdProperty;
  onSendTouch: () => void;
}) {
  const refiYears = p.mortgageMaturity
    ? ((new Date(p.mortgageMaturity).getTime() - Date.now()) / (1000 * 3600 * 24 * 365.25))
    : null;
  return (
    <div className="rounded border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] px-4 py-3 transition-colors">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Left: identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link
              href={`/cre-os/properties/${p.slug ?? p.id}`}
              className="font-heading text-[14px] text-cream font-semibold hover:text-coral-300 truncate"
            >
              {p.name ?? p.address ?? "(unnamed)"}
            </Link>
            {p.forSaleStatus && (
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-300 bg-coral-400/[0.10] border border-coral-400/30 px-1.5 py-0.5 rounded">
                {p.forSaleStatus}
              </span>
            )}
            {p.buildingClass && (
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">
                Class {p.buildingClass}
              </span>
            )}
          </div>
          <div className="font-body text-[11.5px] text-cream-dim mt-0.5 truncate">
            {[p.address, p.city, p.state].filter(Boolean).join(", ") || p.county || "—"}
            {p.submarket && <span className="text-cream-subtle"> · {p.submarket}</span>}
          </div>

          {/* Owner block */}
          <div className="mt-2 flex items-baseline gap-2 flex-wrap font-body text-[11.5px]">
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Owner</span>
            <span className="text-cream font-semibold truncate max-w-[34ch]">
              {p.trueOwnerName ?? p.ownerNameRaw ?? "—"}
            </span>
            {p.trueOwnerName && p.ownerNameRaw && p.trueOwnerName !== p.ownerNameRaw && (
              <span className="text-cream-subtle text-[10.5px]">(behind {p.ownerNameRaw})</span>
            )}
            {p.ownerType && (
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{p.ownerType}</span>
            )}
            {p.ownerOutOfState && (
              <span className="font-mono text-[9px] uppercase tracking-eyebrow text-amber">OOS{p.trueOwnerState ? ` · ${p.trueOwnerState}` : ""}</span>
            )}
            {p.bestPhone && (
              <span className="font-mono text-[10.5px] text-teal-300">
                📞 {p.bestPhone}
                <span className="text-cream-subtle ml-1">({p.bestPhoneSource})</span>
              </span>
            )}
          </div>

          {/* Signals + lanes */}
          {(p.signalFlags.length > 0 || p.activeLanes.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.signalFlags.slice(0, 4).map((f) => (
                <span key={f} className="font-mono text-[9px] uppercase tracking-eyebrow text-amber bg-amber/[0.08] border border-amber/30 px-1.5 py-0.5 rounded">
                  {f.replace(/_/g, " ")}
                </span>
              ))}
              {p.signalFlags.length > 4 && (
                <span className="font-mono text-[9px] text-cream-subtle">+{p.signalFlags.length - 4}</span>
              )}
              {p.activeLanes.map((l) => (
                <span key={l.id} className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-300 bg-coral-400/[0.08] border border-coral-400/30 px-1.5 py-0.5 rounded">
                  {l.name.replace(/^Lane [A-Z] — /, "")}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: numbers + actions */}
        <div className="shrink-0 flex flex-col items-end gap-2 min-w-[180px]">
          {/* Metrics row */}
          <div className="flex gap-3 font-mono text-[10.5px] text-right">
            {p.assetType && (
              <Metric label="Type" value={p.assetType} />
            )}
            {p.sqft != null && p.sqft > 0 && (
              <Metric label="SF" value={p.sqft.toLocaleString()} />
            )}
            {p.units != null && p.units > 0 && (
              <Metric label="Units" value={p.units.toLocaleString()} />
            )}
            {p.yearBuilt != null && p.yearBuilt > 1700 && (
              <Metric label="Built" value={String(p.yearBuilt)} />
            )}
          </div>
          {/* Money row */}
          <div className="flex gap-3 font-mono text-[10.5px] text-right">
            {p.forSalePrice != null && p.forSalePrice > 0 && (
              <Metric label="Ask" value={fmtMoney(p.forSalePrice)} tone="coral" />
            )}
            {p.lastSalePrice != null && p.lastSalePrice > 0 && (
              <Metric label="Last sale" value={fmtMoney(p.lastSalePrice)} />
            )}
            {p.yearsOwned != null && (
              <Metric label="Years held" value={`${p.yearsOwned}y`} tone={p.yearsOwned >= 15 ? "teal" : "default"} />
            )}
            {p.capRate != null && p.capRate > 0 && (
              <Metric label="Cap" value={`${p.capRate}%`} />
            )}
          </div>
          {/* Loan row */}
          {(p.mortgageMaturity || p.loanLender || p.loanAmount) && (
            <div className="flex gap-3 font-mono text-[10.5px] text-right">
              {p.mortgageMaturity && (
                <Metric
                  label="Refi"
                  value={refiYears != null && refiYears < 2 ? `${refiYears.toFixed(1)}y` : new Date(p.mortgageMaturity).toLocaleDateString()}
                  tone={refiYears != null && refiYears < 2 ? "coral" : "default"}
                />
              )}
              {p.loanLender && (
                <Metric label="Lender" value={p.loanLender.length > 16 ? p.loanLender.slice(0, 16) + "…" : p.loanLender} />
              )}
              {p.loanAmount != null && p.loanAmount > 0 && (
                <Metric label="Loan" value={fmtMoney(p.loanAmount)} />
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={onSendTouch}
              className="px-3 py-1.5 rounded border border-white/[0.10] bg-white/[0.02] hover:bg-coral-400/[0.10] hover:border-coral-400/40 font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-coral-300 transition-colors"
            >
              Send touch
            </button>
            <Link
              href={`/cre-os/properties/${p.slug ?? p.id}`}
              className="px-3 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.08] hover:bg-coral-400/[0.16] font-mono text-[10px] uppercase tracking-eyebrow text-coral-300 transition-colors"
            >
              View →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "coral" | "teal" }) {
  const t = tone === "coral" ? "text-coral-300" : tone === "teal" ? "text-teal-300" : "text-cream";
  return (
    <div>
      <div className="text-[8.5px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`${t} tabular-nums`}>{value}</div>
    </div>
  );
}
