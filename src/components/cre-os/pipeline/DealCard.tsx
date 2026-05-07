"use client";

import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { DealCardData } from "@/lib/cre-os/pipeline-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * DealCard — a single deal on the pipeline kanban. Three lines of info:
 *   • Title row: deal name (or property/contact fallback)
 *   • Mono caption: city · type · price
 *   • Footer: probability, days-in-stage, signal chips (stale, hot leads)
 *
 * Coral left-bar appears when stale. Tappable to /cre-os/pipeline/[id].
 */
export function DealCard({ d }: { d: DealCardData }) {
  const title = d.dealName ?? d.property?.name ?? d.contact?.fullName ?? "(unnamed deal)";
  const subline = [
    d.property?.city ?? d.contact?.email ?? null,
    d.dealType ? d.dealType.replace("_", " ") : null,
    d.price ? fmtMoney(d.price) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <a
      href={`/cre-os/pipeline/${d.id}`}
      className={`block group bg-steward-surface/40 border border-white/[0.05] hover:border-coral-400/30 hover:bg-steward-surface/60 rounded-md p-3 relative transition-all ${
        d.stale ? "border-l-2 border-l-coral-400" : ""
      }`}
    >
      <div className="font-heading text-[12px] font-semibold text-cream group-hover:text-coral-300 transition-colors leading-snug truncate">
        {title}
      </div>
      <div className="mt-1 font-mono text-[10px] text-cream-subtle uppercase tracking-wide truncate">
        {subline || "—"}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 pt-2 border-t border-white/[0.04]">
        <div className="font-mono text-[10px] text-cream-dim">
          {d.probabilityPct !== null ? `${Math.round(d.probabilityPct)}%` : "—"}
          {d.daysInStage !== null && (
            <span className="ml-2 text-cream-subtle">
              · {d.daysInStage}d
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {d.stale && <StatusBadge size="xs" tone="coral">Stale</StatusBadge>}
          {d.openTasks > 0 && <StatusBadge size="xs" tone="amber">{d.openTasks}</StatusBadge>}
        </div>
      </div>
    </a>
  );
}
