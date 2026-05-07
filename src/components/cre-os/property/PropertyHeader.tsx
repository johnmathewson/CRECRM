"use client";

import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * PropertyHeader — sticky page-top frame for a property workspace. Holds the
 * masthead (name, address, stage/status badges) and a quick-action cluster.
 *
 * Visual language: editorial display title in serif, mono address, coral
 * accent line under the eyebrow. Status pills tell the reader the asset's
 * disposition at a glance.
 */
export function PropertyHeader({ p }: { p: PropertyDetail }) {
  const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
  const statusTone = pillToneForStatus(p.status);
  const stageTone = pillToneForStage(p.pipelineStage);

  const valuationCaption = [
    p.askingPrice ? fmtMoney(p.askingPrice) : null,
    p.sqft ? `${p.sqft.toLocaleString()} SF` : null,
    p.capRate ? `${(p.capRate * 100).toFixed(2)}% cap` : null,
    p.occupancyPct ? `${(p.occupancyPct * 100).toFixed(0)}% occ` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bg-steward-base/80 backdrop-blur-md border-b border-white/[0.04] -mx-8 px-8 -mt-6 pt-6 pb-5 mb-6">
      <Eyebrow tone="coral">
        {(p.assetType || "Property").toString().toUpperCase()}
        {p.transactionType && (
          <span className="ml-3 text-cream-subtle">
            ·  {p.transactionType.replace("_", " ").toUpperCase()}
          </span>
        )}
      </Eyebrow>

      <div className="mt-2 flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-medium text-3xl text-cream tracking-tight leading-tight">
            {p.name}
          </h1>
          {fullAddress && (
            <div className="mt-1 font-mono text-[11px] text-cream-dim uppercase tracking-wide">
              {fullAddress}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {p.status && <StatusBadge tone={statusTone}>{p.status.replace("_", " ")}</StatusBadge>}
            {p.pipelineStage && <StatusBadge tone={stageTone}>{p.pipelineStage}</StatusBadge>}
            {p.yourRole && (
              <span className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">
                · {p.yourRole.replace("_", " ")}
              </span>
            )}
          </div>

          {valuationCaption && (
            <div className="mt-2 font-mono text-[11px] text-cream-dim">{valuationCaption}</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={`/valuate?address=${encodeURIComponent(fullAddress || p.name)}`}
            className="px-3 py-2 rounded border border-coral-400/40 bg-coral-400/[0.06] text-coral-300 hover:bg-coral-400/[0.10] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
          >
            Run valuation
          </a>
          <button className="px-3 py-2 rounded border border-white/10 bg-white/[0.03] text-cream hover:bg-white/[0.06] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors">
            Generate OM
          </button>
          <button className="px-3 py-2 rounded border border-white/10 bg-white/[0.03] text-cream hover:bg-white/[0.06] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors">
            Owner update
          </button>
        </div>
      </div>
    </div>
  );
}

function pillToneForStatus(s: string | null): "coral" | "teal" | "amber" | "neutral" {
  if (!s) return "neutral";
  const v = s.toLowerCase();
  if (v === "active" || v === "listed") return "coral";
  if (v === "leased" || v === "closed" || v === "sold") return "teal";
  if (v === "idea" || v === "draft") return "neutral";
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
