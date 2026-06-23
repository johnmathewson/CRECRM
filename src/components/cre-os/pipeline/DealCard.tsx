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
 * Coral left-bar appears when stale.
 *
 * Draggable. Click opens whatever the parent wires up (peek panel by
 * default). Previously this card was an <a href> to /cre-os/pipeline/[id]
 * which forced a page nav AND blocked HTML5 drag (browser native anchor
 * drag overrides our handlers). Switched to <div> + onClick / draggable
 * so DnD actually works and the parent controls click behavior.
 */
export function DealCard({
  d,
  onCardClick,
  onCardDragStart,
  onCardDragEnd,
}: {
  d: DealCardData;
  onCardClick?: (deal: DealCardData) => void;
  onCardDragStart?: (dealId: string) => void;
  onCardDragEnd?: () => void;
}) {
  const title = d.dealName ?? d.property?.name ?? d.contact?.fullName ?? "(unnamed deal)";
  const subline = [
    d.property?.city ?? d.contact?.email ?? null,
    d.dealType ? d.dealType.replace("_", " ") : null,
    d.price ? fmtMoney(d.price) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Suppress click navigation when a drag started — otherwise the
  // mouseup at the drop site fires a click and opens the peek for
  // the card you just dropped.
  let dragStarted = false;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        dragStarted = true;
        e.dataTransfer.setData("text/plain", d.id);
        e.dataTransfer.effectAllowed = "move";
        onCardDragStart?.(d.id);
      }}
      onDragEnd={() => {
        setTimeout(() => { dragStarted = false; }, 0);
        onCardDragEnd?.();
      }}
      onClick={() => { if (!dragStarted) onCardClick?.(d); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onCardClick?.(d);
        }
      }}
      className={`block group bg-steward-surface/40 border border-white/[0.05] hover:border-coral-400/30 hover:bg-steward-surface/60 rounded-md p-3 relative transition-all cursor-grab active:cursor-grabbing focus:outline-none focus:border-coral-400/40 ${
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
    </div>
  );
}
