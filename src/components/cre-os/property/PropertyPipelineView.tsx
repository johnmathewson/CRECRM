"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { PipelineColumn, PipelinePropertyCard } from "@/app/cre-os/properties/pipeline/page";

/**
 * Property Pipeline kanban — properties grouped by lifecycle stage.
 *
 * Drag-and-drop reorders properties across stages. Drop fires
 * POST /api/properties/[id]/lifecycle with skipReadinessCheck=true
 * so DnD never gets blocked by the Go-Live readiness gate — that
 * gate still runs from the dedicated workspace button where the
 * blocker modal can render. Kanban DnD is for the broker doing
 * fast lifecycle management.
 *
 * Optimistic: the card jumps to the target column immediately and
 * we revert on API failure. router.refresh() pulls the canonical
 * groupings back from the server so days-in-stage stamps + counts
 * stay accurate.
 *
 * Column → target status mapping mirrors the lifecycle state machine:
 *   Lead          → 'prospect'         (regression-friendly)
 *   Prospecting   → 'prospecting'
 *   Pitched       → 'pitched'
 *   Listing       → 'listed'           (skipReadinessCheck bypasses gate)
 *   Under Contract→ 'under_contract'
 *   Closed        → 'sold'             (lease properties get this too;
 *                                       the lifecycle route treats 'closed'
 *                                       transition uniformly)
 */

const COLUMN_TO_STAGE: Record<string, string | null> = {
  lead: null,                  // 'prospect' isn't a lifecycle endpoint stage
  prospecting: "prospecting",
  pitched: "pitched",
  listing: "listed",
  under_contract: "under_contract",
  closed: "closed",
};

export function PropertyPipelineView({ columns: initialColumns }: { columns: PipelineColumn[] }) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [dragging, setDragging] = useState<{ cardId: string; fromColKey: string } | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const totalActive = columns.reduce((s, c) => s + (c.key === "lead" ? 0 : c.cards.length), 0);

  function onDragStart(cardId: string, fromColKey: string) {
    setDragging({ cardId, fromColKey });
    setError(null);
  }

  function onDragEnd() {
    setDragging(null);
    setHoverCol(null);
  }

  async function onDrop(toColKey: string) {
    setHoverCol(null);
    if (!dragging) return;
    if (toColKey === dragging.fromColKey) {
      setDragging(null);
      return;
    }

    // The Lead column has no clean lifecycle endpoint mapping
    // (regression from past-Lead → Lead is rare and would require
    // resetting status='prospect' + clearing timestamps). Block for now.
    if (toColKey === "lead") {
      setError("Moving a property back to Lead isn't supported via drag — edit the property directly.");
      setDragging(null);
      return;
    }

    const targetStage = COLUMN_TO_STAGE[toColKey];
    if (!targetStage) {
      setError(`Unknown column: ${toColKey}`);
      setDragging(null);
      return;
    }

    const cardId = dragging.cardId;
    const fromColKey = dragging.fromColKey;
    setDragging(null);

    // Optimistic move — pop card from source col, push to target.
    // Snapshot for revert if API fails.
    const snapshot = columns;
    setColumns((prev) => {
      const next = prev.map((c) => ({ ...c, cards: [...c.cards] }));
      const fromCol = next.find((c) => c.key === fromColKey);
      const toCol = next.find((c) => c.key === toColKey);
      if (!fromCol || !toCol) return prev;
      const idx = fromCol.cards.findIndex((card) => card.id === cardId);
      if (idx < 0) return prev;
      const [moved] = fromCol.cards.splice(idx, 1);
      toCol.cards.unshift({ ...moved, daysInStage: 0 });
      return next;
    });

    try {
      const r = await fetch(`/api/properties/${cardId}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: targetStage, skipReadinessCheck: true }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      // Pull authoritative state from the server so timestamps + counts refresh.
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setColumns(snapshot);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Eyebrow tone="coral">Pipeline · Lifecycle</Eyebrow>
            <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">
              Property Pipeline
            </h1>
            <p className="mt-1 font-mono text-[11px] text-cream-subtle">
              {totalActive} active asset{totalActive === 1 ? "" : "s"} across the lifecycle (excluding Lead column) · drag cards to move stages
            </p>
          </div>
          <Link
            href="/cre-os/properties"
            className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
          >
            Grid view ↗
          </Link>
        </header>

        {error && (
          <div className="rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
            {error}
          </div>
        )}

        {/* Horizontal scroll on small screens; multi-column at lg+ */}
        <div className="flex gap-4 overflow-x-auto pb-4 lg:overflow-x-visible lg:grid lg:grid-cols-6">
          {columns.map((col) => (
            <Column
              key={col.key}
              col={col}
              isDragTarget={hoverCol === col.key && dragging !== null && col.key !== dragging.fromColKey}
              onCardDragStart={onDragStart}
              onCardDragEnd={onDragEnd}
              onColDragOver={() => setHoverCol(col.key)}
              onColDragLeave={() => setHoverCol((cur) => (cur === col.key ? null : cur))}
              onColDrop={() => onDrop(col.key)}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Column({
  col,
  isDragTarget,
  onCardDragStart,
  onCardDragEnd,
  onColDragOver,
  onColDragLeave,
  onColDrop,
}: {
  col: PipelineColumn;
  isDragTarget: boolean;
  onCardDragStart: (cardId: string, fromColKey: string) => void;
  onCardDragEnd: () => void;
  onColDragOver: () => void;
  onColDragLeave: () => void;
  onColDrop: () => void;
}) {
  const toneClass: Record<PipelineColumn["tone"], string> = {
    neutral: "text-cream-subtle border-white/[0.08]",
    amber: "text-amber-300 border-amber-400/30",
    coral: "text-coral-300 border-coral-400/30",
    teal: "text-teal-300 border-teal-400/30",
  };
  const accent: Record<PipelineColumn["tone"], string> = {
    neutral: "bg-cream-subtle/50",
    amber: "bg-amber-400",
    coral: "bg-coral-400",
    teal: "bg-teal-400",
  };

  return (
    <div
      className="w-72 lg:w-auto shrink-0 lg:shrink space-y-3"
      onDragOver={(e) => {
        e.preventDefault();
        onColDragOver();
      }}
      onDragLeave={onColDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onColDrop();
      }}
    >
      <div className={`pb-2 border-b ${toneClass[col.tone]}`}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${accent[col.tone]}`} />
            <span className="font-mono text-[10px] uppercase tracking-eyebrow font-semibold">
              {col.label}
            </span>
          </div>
          <span className="font-mono text-[10px] text-cream-subtle">{col.cards.length}</span>
        </div>
        <p className="mt-1 font-body text-[10.5px] text-cream-subtle leading-relaxed">
          {col.description}
        </p>
      </div>

      <div
        className={`space-y-2 min-h-[60px] rounded transition-colors ${
          isDragTarget ? "bg-coral-400/[0.04] outline outline-1 outline-coral-400/30" : ""
        }`}
      >
        {col.cards.length === 0 ? (
          <div className="rounded border border-white/[0.04] bg-white/[0.01] px-3 py-4 text-center">
            <p className="font-mono text-[10px] text-cream-subtle italic">
              {isDragTarget ? "drop here" : "empty"}
            </p>
          </div>
        ) : (
          col.cards.map((c) => (
            <Card
              key={c.id}
              c={c}
              onDragStart={() => onCardDragStart(c.id, col.key)}
              onDragEnd={onCardDragEnd}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Card({
  c,
  onDragStart,
  onDragEnd,
}: {
  c: PipelinePropertyCard;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const fmtMoney = (n: number | null): string => {
    if (!n || !Number.isFinite(n) || n <= 0) return "—";
    if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return "$" + Math.round(n / 1_000) + "K";
    return "$" + n.toLocaleString();
  };
  return (
    <Link
      href={`/cre-os/properties/${c.slug}`}
      draggable
      onDragStart={(e) => {
        // Required for Firefox to actually start a drag operation
        e.dataTransfer.setData("text/plain", c.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="block rounded border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] p-3 transition-colors group cursor-grab active:cursor-grabbing"
    >
      <div className="font-heading text-[12.5px] text-cream font-semibold truncate group-hover:text-coral-300 transition-colors">
        {c.name}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">
        {[c.address, c.city].filter(Boolean).join(", ") || (c.asset_type ? c.asset_type : "—")}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-coral-300 font-semibold">
          {fmtMoney(c.asking_price)}
        </span>
        {c.sqft && (
          <span className="font-mono text-[10px] text-cream-subtle">
            {c.sqft.toLocaleString()} SF
          </span>
        )}
      </div>
      {c.daysInStage !== null && c.daysInStage >= 0 && (
        <div className="mt-1.5 font-mono text-[9.5px] text-cream-subtle">
          {c.daysInStage}d in {labelForStatus(c.status)}
        </div>
      )}
    </Link>
  );
}

function labelForStatus(status: string | null): string {
  if (!status) return "stage";
  if (status === "prospect" || status === "idea") return "Lead";
  if (status === "under_contract") return "UC";
  if (status === "sold" || status === "leased") return "Closed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}
