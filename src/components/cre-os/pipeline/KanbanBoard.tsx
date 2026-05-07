"use client";

import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { DealCard } from "./DealCard";
import { getStageConfig } from "@/lib/cre-os/stage-config";
import type { PipelineBoard } from "@/lib/cre-os/pipeline-queries";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * KanbanBoard — horizontal scrolling kanban. One column per active stage,
 * coral header eyebrow, count + stage value at the top, deal cards stacked
 * inside. Empty columns show a faint placeholder so the ladder shape stays
 * visible.
 */
export function KanbanBoard({ board }: { board: PipelineBoard }) {
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <div className="flex gap-3 min-w-max pb-4">
        {board.columns.map((col) => {
          const cfg = getStageConfig(col.stage);
          return (
            <div key={col.stage} className="w-[260px] shrink-0">
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
                      · {fmtMoney(col.weightedValue)} weighted
                    </span>
                  )}
                </div>
              </div>

              {/* Cards */}
              <div className="mt-3 space-y-2 min-h-[60px]">
                {col.cards.length === 0 ? (
                  <div className="text-center py-6 px-2 border border-dashed border-white/[0.05] rounded">
                    <p className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">
                      No deals
                    </p>
                  </div>
                ) : (
                  col.cards.map((c) => <DealCard key={c.id} d={c} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
