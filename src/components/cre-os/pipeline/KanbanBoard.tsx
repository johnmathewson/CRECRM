"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { DealCard } from "./DealCard";
import { getStageConfig } from "@/lib/cre-os/stage-config";
import type { PipelineBoard, DealCardData } from "@/lib/cre-os/pipeline-queries";
import type { StageKey } from "@/lib/cre-os/stage-config";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * KanbanBoard — horizontal scrolling kanban. One column per active stage,
 * coral header eyebrow, count + stage value at the top, deal cards stacked
 * inside.
 *
 * Drag-and-drop: drag a card across columns, drop fires onCardMove with
 * the target stage. Parent owns the optimistic update + API call so the
 * column counts/values stay accurate.
 *
 * Click: onCardClick fires when a card is clicked (not dragged). Parent
 * decides what happens — defaults to opening the property peek panel
 * (keeps the kanban visible behind the slide-over).
 */
export function KanbanBoard({
  board,
  onCardMove,
  onCardClick,
}: {
  board: PipelineBoard;
  onCardMove?: (dealId: string, targetStage: StageKey, fromStage: StageKey) => void;
  onCardClick?: (deal: DealCardData) => void;
}) {
  // Track which column the user is dragging into for visual feedback.
  // Source-column key is captured at dragstart so we can ignore drops
  // back into the same column (no-op).
  const [dragging, setDragging] = useState<{ dealId: string; fromStage: StageKey } | null>(null);
  const [hoverStage, setHoverStage] = useState<StageKey | null>(null);

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <div className="flex gap-3 min-w-max pb-4">
        {board.columns.map((col) => {
          const cfg = getStageConfig(col.stage);
          const isDragTarget =
            hoverStage === col.stage && dragging !== null && dragging.fromStage !== col.stage;
          return (
            <div
              key={col.stage}
              className="w-[260px] shrink-0"
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setHoverStage(col.stage);
              }}
              onDragLeave={() =>
                setHoverStage((cur) => (cur === col.stage ? null : cur))
              }
              onDrop={(e) => {
                e.preventDefault();
                setHoverStage(null);
                if (!dragging) return;
                const { dealId, fromStage } = dragging;
                setDragging(null);
                if (fromStage === col.stage) return; // no-op same-column drop
                onCardMove?.(dealId, col.stage, fromStage);
              }}
            >
              {/* Column header */}
              <div className="px-2 py-2 border-b border-white/[0.06]">
                <div className="flex items-baseline justify-between gap-2">
                  <Eyebrow tone={cfg.tone === "neutral" ? "muted" : cfg.tone}>{col.stage}</Eyebrow>
                  <span className="font-mono text-[10px] text-cream-dim">{col.count}</span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display font-medium text-base text-cream leading-none">
                    {col.totalValue > 0 ? fmtMoney(col.totalValue) : "—"}
                  </span>
                  {col.weightedValue > 0 && col.weightedValue !== col.totalValue && (
                    <span className="font-mono text-[10px] text-cream-subtle">
                      · {fmtMoney(col.weightedValue)} wtd
                    </span>
                  )}
                </div>
                {col.totalCommission > 0 && (
                  <div className="mt-1 font-mono text-[10px] text-coral-300/80">
                    {fmtMoney(col.totalCommission)} comm
                    {col.weightedCommission > 0 && col.weightedCommission !== col.totalCommission && (
                      <span className="text-cream-subtle">
                        {" "}· {fmtMoney(col.weightedCommission)} wtd
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Cards */}
              <div
                className={`mt-3 space-y-2 min-h-[60px] rounded transition-colors ${
                  isDragTarget ? "bg-coral-400/[0.04] outline outline-1 outline-coral-400/30" : ""
                }`}
              >
                {col.cards.length === 0 ? (
                  <div className="text-center py-6 px-2 border border-dashed border-white/[0.05] rounded">
                    <p className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">
                      {isDragTarget ? "Drop here" : "No deals"}
                    </p>
                  </div>
                ) : (
                  col.cards.map((c) => (
                    <DealCard
                      key={c.id}
                      d={c}
                      onCardClick={onCardClick}
                      onCardDragStart={(dealId) =>
                        setDragging({ dealId, fromStage: col.stage })
                      }
                      onCardDragEnd={() => {
                        setDragging(null);
                        setHoverStage(null);
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
