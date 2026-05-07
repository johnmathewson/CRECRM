"use client";

import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { PropertyCard } from "@/lib/cre-os/property-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * PropertyListCard — single asset card on the /cre-os/properties index.
 * Editorial layout: eyebrow with asset type, display-serif name, mono address,
 * stats row, and tappable signal chips on the right (hot leads, days since
 * touch, open tasks).
 */
export function PropertyListCard({ p }: { p: PropertyCard }) {
  const fullAddress = [p.address, p.city, p.state].filter(Boolean).join(", ");
  const statusTone = pillToneForStatus(p.status);
  const stageTone = pillToneForStage(p.pipelineStage);

  return (
    <a
      href={`/cre-os/properties/${p.slug}`}
      className="block group relative bg-steward-surface/40 border border-white/[0.05] hover:border-coral-400/30 hover:bg-steward-surface/60 rounded-md p-5 transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Eyebrow tone="coral">
            {(p.assetType || "Property").toUpperCase()}
            {p.transactionType && (
              <span className="ml-2 text-cream-subtle">·  {p.transactionType.replace("_", " ").toUpperCase()}</span>
            )}
          </Eyebrow>
          <h3 className="mt-1 font-display text-lg text-cream tracking-tight group-hover:text-coral-300 transition-colors">
            {p.name}
          </h3>
          {fullAddress && (
            <div className="mt-0.5 font-mono text-[10px] text-cream-subtle uppercase tracking-wide truncate">
              {fullAddress}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {p.status && <StatusBadge size="xs" tone={statusTone}>{p.status.replace("_", " ")}</StatusBadge>}
          {p.pipelineStage && <StatusBadge size="xs" tone={stageTone}>{p.pipelineStage}</StatusBadge>}
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-[11px]">
        <Stat label="Asking" value={fmtMoney(p.askingPrice)} />
        <Stat label="SF" value={p.sqft ? p.sqft.toLocaleString() : "—"} />
        <Stat label="NOI" value={fmtMoney(p.noi)} />
        <Stat label="Cap" value={p.capRate ? (p.capRate * 100).toFixed(2) + "%" : "—"} />
      </div>

      {/* Signal chips */}
      {(p.hotLeads > 0 || p.openTasks > 0 || (p.daysSinceTouch !== null && p.daysSinceTouch > 7)) && (
        <div className="mt-4 pt-3 border-t border-white/[0.04] flex flex-wrap items-center gap-2">
          {p.hotLeads > 0 && (
            <span className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-300 bg-coral-400/[0.10] border border-coral-400/30 rounded px-1.5 py-0.5">
              {p.hotLeads} hot lead{p.hotLeads === 1 ? "" : "s"}
            </span>
          )}
          {p.openTasks > 0 && (
            <span className="font-heading text-[10px] uppercase tracking-eyebrow text-amber bg-amber/10 border border-amber/30 rounded px-1.5 py-0.5">
              {p.openTasks} task{p.openTasks === 1 ? "" : "s"}
            </span>
          )}
          {p.daysSinceTouch !== null && p.daysSinceTouch > 12 && (
            <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-dim bg-white/[0.04] border border-white/10 rounded px-1.5 py-0.5">
              {p.daysSinceTouch} days quiet
            </span>
          )}
        </div>
      )}
    </a>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="font-mono text-cream font-medium">{value}</div>
    </div>
  );
}

function pillToneForStatus(s: string | null): "coral" | "teal" | "amber" | "neutral" {
  if (!s) return "neutral";
  const v = s.toLowerCase();
  if (v === "active" || v === "listed") return "coral";
  if (v === "leased" || v === "closed" || v === "sold") return "teal";
  if (v === "at_risk" || v === "stale") return "amber";
  return "neutral";
}

function pillToneForStage(s: string | null): "coral" | "teal" | "amber" | "neutral" {
  if (!s) return "neutral";
  const v = s.toLowerCase();
  if (v.includes("closing")) return "teal";
  if (v.includes("loi") || v.includes("under contract") || v.includes("dd") || v.includes("due diligence")) return "amber";
  if (v.includes("listing") || v.includes("active")) return "coral";
  return "neutral";
}
