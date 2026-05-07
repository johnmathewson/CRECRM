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
 * PropertyFeaturedCard — bigger card for "Today's Focus". Used at the top
 * of the inventory page to highlight assets the broker should work first.
 *
 * Difference from PropertyListCard:
 *   - Wider (2-up grid, vs 3-up for the regular list)
 *   - Shows the synthesized "why this is priority" headline prominently
 *   - Coral border + glow shadow when urgent
 *   - Action chip is a CTA, not just text
 *   - More stats visible (occupancy, $/SF)
 */
export function PropertyFeaturedCard({ p }: { p: PropertyCard }) {
  const fullAddress = [p.address, p.city, p.state].filter(Boolean).join(", ");
  const urgent = p.priorityScore >= 3;
  const reasons = buildReasons(p);
  const ppsf = p.askingPrice && p.sqft ? p.askingPrice / p.sqft : null;

  return (
    <a
      href={`/cre-os/properties/${p.slug}`}
      className={`block group relative bg-steward-mid/60 hover:bg-steward-mid/80 rounded-md border ${
        urgent
          ? "border-coral-400/40 shadow-coral-glow"
          : "border-amber/30"
      } hover:border-coral-400/60 transition-all p-6`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Eyebrow tone="coral">
            {(p.assetType || "Property").toUpperCase()}
            {p.transactionType && (
              <span className="ml-2 text-cream-subtle">·  {p.transactionType.replace("_", " ").toUpperCase()}</span>
            )}
            <span className="ml-3 text-cream-subtle">·  PRIORITY</span>
          </Eyebrow>
          <h3 className="mt-1 font-display text-2xl text-cream tracking-tight group-hover:text-coral-300 transition-colors leading-tight">
            {p.name}
          </h3>
          {fullAddress && (
            <div className="mt-1 font-mono text-[10px] text-cream-subtle uppercase tracking-wide">
              {fullAddress}
            </div>
          )}
        </div>

        {/* Lifecycle badges */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {p.status && (
            <StatusBadge size="xs" tone={pillToneForStatus(p.status)}>
              {p.status.replace("_", " ")}
            </StatusBadge>
          )}
          {p.pipelineStage && (
            <StatusBadge size="xs" tone={pillToneForStage(p.pipelineStage)}>
              {p.pipelineStage}
            </StatusBadge>
          )}
        </div>
      </div>

      {/* Reasons-this-is-priority */}
      {reasons.length > 0 && (
        <div className="mt-4 p-3 rounded bg-black/30 border-l-2 border-l-coral-400">
          <div className="font-heading text-[11px] font-semibold uppercase tracking-eyebrow text-coral-300 mb-1.5">
            Why this is priority
          </div>
          <ul className="space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="font-body text-[12px] text-cream-dim leading-snug flex items-start gap-2">
                <span className="mt-1 w-1 h-1 rounded-full bg-coral-400 shrink-0" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats grid */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-2">
        <Stat label="Asking" value={fmtMoney(p.askingPrice)} accent />
        <Stat label="$/SF" value={ppsf ? "$" + ppsf.toFixed(0) : "—"} />
        <Stat label="SF" value={p.sqft ? p.sqft.toLocaleString() : "—"} />
        <Stat label="NOI" value={fmtMoney(p.noi)} />
        <Stat label="Cap" value={p.capRate ? (p.capRate * 100).toFixed(2) + "%" : "—"} />
      </div>

      {/* Next action CTA */}
      {p.nextAction && (
        <div className="mt-5 pt-4 border-t border-white/[0.04] flex items-center justify-between gap-3">
          <div className="font-mono text-[10px] text-cream-subtle">
            {p.daysSinceTouch !== null
              ? `Last touched ${p.daysSinceTouch}d ago`
              : "No activity logged"}
          </div>
          <span className="px-3 py-1.5 rounded border border-coral-400/40 bg-coral-400/10 text-coral-300 font-heading text-[11px] font-semibold uppercase tracking-eyebrow">
            → {p.nextAction}
          </span>
        </div>
      )}
    </a>
  );
}

function buildReasons(p: PropertyCard): string[] {
  const reasons: string[] = [];
  if (p.hotLeads > 0) reasons.push(`${p.hotLeads} hot inquiry${p.hotLeads === 1 ? "" : "s"} pending response`);
  if (p.overdueTasks > 0) reasons.push(`${p.overdueTasks} task${p.overdueTasks === 1 ? "" : "s"} overdue`);
  if (p.isStale) reasons.push(`Listed but quiet for ${p.daysSinceTouch}+ days — listing performance signal`);
  else if (p.isQuiet) reasons.push(`No activity in ${p.daysSinceTouch} days — owner update due`);
  if (p.isMissingValuation) reasons.push("Listed without a current BOV");
  return reasons;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-0.5 font-${accent ? "display text-lg" : "mono text-[12px]"} ${accent ? "text-coral-300" : "text-cream"} font-medium`}>{value}</div>
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
