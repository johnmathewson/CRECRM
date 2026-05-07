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
 * PropertyListCard — single asset card on the inventory grid.
 *
 * Three distinct information layers, separated visually:
 *   • Lifecycle (top-right): status + stage. What kind of asset is this?
 *   • Stats (mid): asking, SF, NOI, cap. Hard facts.
 *   • Intelligence (bottom): what's happening now? Activity line + signal
 *     badges (hot, quiet, stale, missing val) + next-action chip.
 *
 * Visual urgency cue: coral left-bar when priorityScore > 0; muted left-bar
 * when calm. Lets the broker scan the grid for "what matters today".
 */
export function PropertyListCard({ p }: { p: PropertyCard }) {
  const fullAddress = [p.address, p.city, p.state].filter(Boolean).join(", ");
  const statusTone = pillToneForStatus(p.status);
  const stageTone = pillToneForStage(p.pipelineStage);
  const urgent = p.priorityScore >= 3;
  const warm = p.priorityScore >= 1 && p.priorityScore < 3;

  const cardBorder = urgent
    ? "border-l-2 border-l-coral-400 border-y border-r border-y-white/[0.06] border-r-white/[0.06]"
    : warm
      ? "border-l-2 border-l-amber/60 border-y border-r border-y-white/[0.05] border-r-white/[0.05]"
      : "border border-white/[0.05]";

  return (
    <a
      href={`/cre-os/properties/${p.slug}`}
      className={`block group relative bg-steward-mid/50 hover:bg-steward-mid/80 rounded-md transition-all ${cardBorder} hover:border-coral-400/30`}
    >
      <div className="p-5">
        {/* Header — eyebrow + name + address + lifecycle pills */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="coral">
              {(p.assetType || "Property").toUpperCase()}
              {p.transactionType && (
                <span className="ml-2 text-cream-subtle">·  {p.transactionType.replace("_", " ").toUpperCase()}</span>
              )}
            </Eyebrow>
            <h3 className="mt-1 font-display text-lg text-cream tracking-tight group-hover:text-coral-300 transition-colors leading-snug">
              {p.name}
            </h3>
            {fullAddress && (
              <div className="mt-0.5 font-mono text-[10px] text-cream-subtle uppercase tracking-wide truncate">
                {fullAddress}
              </div>
            )}
          </div>

          {/* Lifecycle badges — what KIND of asset is this */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {p.status && <StatusBadge size="xs" tone={statusTone}>{p.status.replace("_", " ")}</StatusBadge>}
            {p.pipelineStage && <StatusBadge size="xs" tone={stageTone}>{p.pipelineStage}</StatusBadge>}
          </div>
        </div>

        {/* Stats row — hard facts */}
        <div className="mt-4 grid grid-cols-4 gap-x-4 gap-y-2">
          <Stat label="Asking" value={fmtMoney(p.askingPrice)} />
          <Stat label="SF" value={p.sqft ? p.sqft.toLocaleString() : "—"} />
          <Stat label="NOI" value={fmtMoney(p.noi)} />
          <Stat label="Cap" value={p.capRate ? (p.capRate * 100).toFixed(2) + "%" : "—"} />
        </div>
      </div>

      {/* Intelligence band — what's happening NOW */}
      {(p.priorityScore > 0 || p.daysSinceTouch !== null) && (
        <div className="px-5 py-3 border-t border-white/[0.04] bg-black/20">
          {/* Activity line */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <ActivityLine p={p} />
            <IntelligenceBadges p={p} />
          </div>

          {/* Next action */}
          {p.nextAction && (
            <div className={`inline-flex items-center gap-1 font-heading text-[10px] font-semibold uppercase tracking-eyebrow ${urgent ? "text-coral-300" : warm ? "text-amber" : "text-cream-dim"}`}>
              → {p.nextAction}
            </div>
          )}
        </div>
      )}
    </a>
  );
}

function ActivityLine({ p }: { p: PropertyCard }) {
  if (p.daysSinceTouch === null) {
    return <span className="font-mono text-[10px] text-cream-subtle">No activity logged</span>;
  }
  const label =
    p.daysSinceTouch === 0 ? "Touched today"
    : p.daysSinceTouch === 1 ? "Touched yesterday"
    : `Last touched ${p.daysSinceTouch}d ago`;
  return <span className="font-mono text-[10px] text-cream-subtle truncate">{label}</span>;
}

function IntelligenceBadges({ p }: { p: PropertyCard }) {
  const badges: Array<{ label: string; tone: "coral" | "amber" | "neutral" }> = [];
  if (p.hotLeads > 0) badges.push({ label: `${p.hotLeads} hot`, tone: "coral" });
  if (p.overdueTasks > 0) badges.push({ label: `${p.overdueTasks} overdue`, tone: "coral" });
  if (p.isStale) badges.push({ label: "Stale", tone: "amber" });
  else if (p.isQuiet) badges.push({ label: "Quiet", tone: "neutral" });
  if (p.isMissingValuation) badges.push({ label: "No BOV", tone: "amber" });
  if (badges.length === 0 && p.openTasks > 0) {
    badges.push({ label: `${p.openTasks} task${p.openTasks === 1 ? "" : "s"}`, tone: "neutral" });
  }
  if (!badges.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {badges.slice(0, 3).map((b, i) => (
        <StatusBadge key={i} size="xs" tone={b.tone}>{b.label}</StatusBadge>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-[12px] text-cream font-medium">{value}</div>
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
