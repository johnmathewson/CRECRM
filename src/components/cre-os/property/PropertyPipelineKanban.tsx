"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PropertyCard } from "@/lib/cre-os/property-queries";

/**
 * PropertyPipelineKanban — embeddable kanban that groups
 * PropertyCard[] by lifecycle stage.
 *
 * Designed to live INSIDE the /cre-os/properties page (not on its
 * own URL), so it doesn't wrap in AppShell. Same drag-and-drop
 * behavior as the standalone view it replaces:
 *
 *   - Drag a card across columns → POST lifecycle endpoint with
 *     skipReadinessCheck=true (Go-Live gate still runs from the
 *     workspace button)
 *   - Optimistic UI: card jumps instantly, revert on API failure,
 *     router.refresh() pulls authoritative state back
 *   - Click a card → onCardClick prop (parent decides: workspace
 *     navigation, peek panel, etc.)
 *
 * Columns derive from PropertyCard.status client-side using the same
 * mapping the server-side kanban used.
 */

const STATUS_TO_COLUMN: Record<string, string> = {
  prospect: "lead",
  idea: "lead",
  prospecting: "prospecting",
  pitched: "pitched",
  listed: "listing",
  under_contract: "under_contract",
  sold: "closed",
  leased: "closed",
};

const COLUMN_TO_STAGE: Record<string, string | null> = {
  lead: null,
  prospecting: "prospecting",
  pitched: "pitched",
  listing: "listed",
  under_contract: "under_contract",
  closed: "closed",
};

type Tone = "neutral" | "amber" | "coral" | "teal";

const COLUMNS: { key: string; label: string; description: string; tone: Tone }[] = [
  { key: "lead",           label: "Lead",           description: "Observed but not pursued yet.",                   tone: "neutral" },
  { key: "prospecting",    label: "Prospecting",    description: "Owner research, BOV in progress, outreach started.", tone: "amber" },
  { key: "pitched",        label: "Pitched",        description: "BOV / proposal presented to the owner.",          tone: "amber" },
  { key: "listing",        label: "Listing",        description: "Signed and active — public marketing live.",       tone: "coral" },
  { key: "under_contract", label: "Under Contract", description: "Offer accepted, due-diligence + financing.",        tone: "teal" },
  { key: "closed",         label: "Closed",         description: "Sale closed or lease executed.",                    tone: "teal" },
];

interface KanbanCard {
  card: PropertyCard;
  columnKey: string;
}

export function PropertyPipelineKanban({
  properties,
  onCardClick,
}: {
  properties: PropertyCard[];
  /** Called when a card is clicked (NOT dragged). Parent decides
   *  whether to navigate, open a peek panel, or something else. */
  onCardClick?: (card: PropertyCard) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Local optimistic overrides: cardId → forced columnKey.
  // Cleared when a row gets refreshed from the server with the new state.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<{ cardId: string; fromColKey: string } | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byColumn = useMemo(() => {
    const map: Record<string, KanbanCard[]> = {};
    for (const col of COLUMNS) map[col.key] = [];
    for (const p of properties) {
      const baseCol = STATUS_TO_COLUMN[(p.status ?? "").toLowerCase()] ?? "lead";
      const col = overrides[p.id] ?? baseCol;
      if (map[col]) map[col].push({ card: p, columnKey: col });
    }
    return map;
  }, [properties, overrides]);

  async function handleDrop(toColKey: string) {
    setHoverCol(null);
    if (!dragging) return;
    if (toColKey === dragging.fromColKey) {
      setDragging(null);
      return;
    }
    if (toColKey === "lead") {
      setError("Moving back to Lead via drag isn't supported — edit the property directly.");
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
    setDragging(null);

    // Optimistic
    setOverrides((prev) => ({ ...prev, [cardId]: toColKey }));
    setError(null);

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
      startTransition(() => router.refresh());
      // Override stays until the server roundtrip lands — that prevents
      // a flicker back to the original column for a beat
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Revert
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[cardId];
        return next;
      });
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
          {error}
        </div>
      )}
      <div className="flex gap-4 overflow-x-auto pb-4 lg:overflow-x-visible lg:grid lg:grid-cols-6">
        {COLUMNS.map((col) => (
          <Column
            key={col.key}
            col={col}
            cards={byColumn[col.key] ?? []}
            isDragTarget={hoverCol === col.key && dragging !== null && col.key !== dragging.fromColKey}
            onCardDragStart={(cardId) => setDragging({ cardId, fromColKey: col.key })}
            onCardDragEnd={() => { setDragging(null); setHoverCol(null); }}
            onColDragOver={() => setHoverCol(col.key)}
            onColDragLeave={() => setHoverCol((cur) => (cur === col.key ? null : cur))}
            onColDrop={() => handleDrop(col.key)}
            onCardClick={onCardClick}
          />
        ))}
      </div>
    </div>
  );
}

function Column({
  col,
  cards,
  isDragTarget,
  onCardDragStart,
  onCardDragEnd,
  onColDragOver,
  onColDragLeave,
  onColDrop,
  onCardClick,
}: {
  col: { key: string; label: string; description: string; tone: Tone };
  cards: KanbanCard[];
  isDragTarget: boolean;
  onCardDragStart: (cardId: string) => void;
  onCardDragEnd: () => void;
  onColDragOver: () => void;
  onColDragLeave: () => void;
  onColDrop: () => void;
  onCardClick?: (card: PropertyCard) => void;
}) {
  const toneClass: Record<Tone, string> = {
    neutral: "text-cream-subtle border-white/[0.08]",
    amber: "text-amber-300 border-amber-400/30",
    coral: "text-coral-300 border-coral-400/30",
    teal: "text-teal-300 border-teal-400/30",
  };
  const accent: Record<Tone, string> = {
    neutral: "bg-cream-subtle/50",
    amber: "bg-amber-400",
    coral: "bg-coral-400",
    teal: "bg-teal-400",
  };

  return (
    <div
      className="w-72 lg:w-auto shrink-0 lg:shrink space-y-3"
      onDragOver={(e) => { e.preventDefault(); onColDragOver(); }}
      onDragLeave={onColDragLeave}
      onDrop={(e) => { e.preventDefault(); onColDrop(); }}
    >
      <div className={`pb-2 border-b ${toneClass[col.tone]}`}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${accent[col.tone]}`} />
            <span className="font-mono text-[10px] uppercase tracking-eyebrow font-semibold">
              {col.label}
            </span>
          </div>
          <span className="font-mono text-[10px] text-cream-subtle">{cards.length}</span>
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
        {cards.length === 0 ? (
          <div className="rounded border border-white/[0.04] bg-white/[0.01] px-3 py-4 text-center">
            <p className="font-mono text-[10px] text-cream-subtle italic">
              {isDragTarget ? "drop here" : "empty"}
            </p>
          </div>
        ) : (
          cards.map(({ card }) => (
            <KanbanCardView
              key={card.id}
              card={card}
              onDragStart={() => onCardDragStart(card.id)}
              onDragEnd={onCardDragEnd}
              onClick={() => onCardClick?.(card)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KanbanCardView({
  card,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  card: PropertyCard;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const fmtMoney = (n: number | null): string => {
    if (!n || !Number.isFinite(n) || n <= 0) return "—";
    if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return "$" + Math.round(n / 1_000) + "K";
    return "$" + n.toLocaleString();
  };

  // Suppress click navigation when a drag started — otherwise the
  // mouseup at the drop site fires a click and you open the peek
  // panel for the card you just dropped.
  let dragStarted = false;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => {
        dragStarted = true;
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={() => {
        setTimeout(() => { dragStarted = false; }, 0);
        onDragEnd();
      }}
      onClick={() => { if (!dragStarted) onClick(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="block rounded border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] p-3 transition-colors group cursor-grab active:cursor-grabbing focus:outline-none focus:border-coral-400/40"
    >
      <div className="font-heading text-[12.5px] text-cream font-semibold truncate group-hover:text-coral-300 transition-colors">
        {card.name}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">
        {[card.address, card.city].filter(Boolean).join(", ") || (card.assetType ? card.assetType : "—")}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] text-coral-300 font-semibold">
          {fmtMoney(card.askingPrice)}
        </span>
        {card.sqft && (
          <span className="font-mono text-[10px] text-cream-subtle">
            {card.sqft.toLocaleString()} SF
          </span>
        )}
      </div>
    </div>
  );
}
