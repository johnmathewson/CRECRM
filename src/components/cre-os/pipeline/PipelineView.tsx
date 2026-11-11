"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import { PipelineScoreboard } from "./PipelineScoreboard";
import type { Scoreboard } from "@/lib/cre-os/scoreboard-queries";
import { KanbanBoard } from "./KanbanBoard";
import { DealList } from "./DealList";
import { CreateDealDialog } from "./CreateDealDialog";
import { PropertyPeekPanel } from "@/components/cre-os/property/PropertyPeekPanel";
import type { PipelineBoard, DealCardData, StageColumn } from "@/lib/cre-os/pipeline-queries";
import type { StageKey } from "@/lib/cre-os/stage-config";
import type { PortalCandidate, PortalContactCandidate } from "@/lib/cre-os/portal-queries";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/** Both sides on one board: columns share the ladder order, so zip them. */
function mergeBoards(a: PipelineBoard, b: PipelineBoard): PipelineBoard {
  const columns: StageColumn[] = a.columns.map((col, i) => {
    const other = b.columns[i];
    return {
      stage: col.stage,
      cards: [...col.cards, ...other.cards].sort((x, y) => (y.daysInStage ?? 0) - (x.daysInStage ?? 0)),
      count: col.count + other.count,
      totalValue: col.totalValue + other.totalValue,
      weightedValue: col.weightedValue + other.weightedValue,
      totalCommission: col.totalCommission + other.totalCommission,
      weightedCommission: col.weightedCommission + other.weightedCommission,
    };
  });
  const n = a.totals.activeDeals + b.totals.activeDeals;
  const probSum = (a.totals.avgProbability ?? 0) * a.totals.activeDeals + (b.totals.avgProbability ?? 0) * b.totals.activeDeals;
  return {
    side: a.side,
    columns,
    totals: {
      activeDeals: n,
      pipelineValue: a.totals.pipelineValue + b.totals.pipelineValue,
      weightedValue: a.totals.weightedValue + b.totals.weightedValue,
      avgProbability: n ? probSum / n : null,
      expectedThisQuarter: a.totals.expectedThisQuarter + b.totals.expectedThisQuarter,
      pipelineCommission: a.totals.pipelineCommission + b.totals.pipelineCommission,
      weightedCommission: a.totals.weightedCommission + b.totals.weightedCommission,
    },
  };
}

const VIEW_KEY = "cre-os.pipeline.view";

/**
 * PipelineView — index page for /cre-os/pipeline. Tabs (Listings,
 * Pursuits, All), the deals as a kanban or a sortable list, and a
 * forecast/health rail.
 *
 * Server pre-loads both boards (parallel) so the tab toggle is instant.
 */
export function PipelineView({
  listings,
  pursuits,
  candidates,
  scoreboard,
}: {
  listings: PipelineBoard;
  pursuits: PipelineBoard;
  candidates: { properties: PortalCandidate[]; contacts: PortalContactCandidate[] };
  scoreboard: Scoreboard;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [side, setSide] = useState<"listings" | "pursuits" | "all">("listings");
  const [view, setView] = useState<"board" | "list">("board");
  const [createOpen, setCreateOpen] = useState(false);

  // Remember Board vs List per browser (a convenience — falls back to board).
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "list") setView("list");
    } catch { /* storage unavailable */ }
  }, []);
  // The scoreboard is long on a phone, so choosing a view also brings the
  // deals into view instead of leaving them a long scroll below.
  const dealsRef = useRef<HTMLDivElement>(null);
  function chooseView(v: "board" | "list") {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
    requestAnimationFrame(() => dealsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  // Local DnD overrides: { [dealId]: newStage }. Layered onto the
  // server-fed board so cards jump instantly on drop. Cleared when
  // the server refresh arrives (rendered board has the canonical
  // stage). Reverted on API failure.
  const [stageOverrides, setStageOverrides] = useState<Record<string, StageKey>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  // Peek panel — opens the property workspace as a slide-over so the
  // pipeline ladder stays visible behind it. Stored as state (not URL)
  // because the deal pipeline doesn't need deep-linkable peek; clicking
  // away is the common way to close.
  const [peekPropertyId, setPeekPropertyId] = useState<string | null>(null);

  // Apply stage overrides to whichever board is active. Recomputes
  // column counts + totals so the header stats match the visual move.
  const allBoard = useMemo(() => mergeBoards(listings, pursuits), [listings, pursuits]);
  const baseBoard = side === "listings" ? listings : side === "pursuits" ? pursuits : allBoard;
  const board: PipelineBoard = useMemo(() => {
    if (Object.keys(stageOverrides).length === 0) return baseBoard;
    // Build a flat list of cards with current effective stage.
    const all: DealCardData[] = baseBoard.columns.flatMap((c) =>
      c.cards.map((card) => {
        const overridden = stageOverrides[card.id];
        return overridden ? { ...card, stage: overridden } : card;
      })
    );
    // Re-bucket by effective stage. Preserve column ORDER from baseBoard.
    const columns: StageColumn[] = baseBoard.columns.map((c) => {
      const cards = all.filter((card) => card.stage === c.stage);
      const totalValue = cards.reduce((s, x) => s + (x.price ?? 0), 0);
      const weightedValue = cards.reduce(
        (s, x) => s + (x.price ?? 0) * ((x.probabilityPct ?? 0) / 100),
        0
      );
      const totalCommission = cards.reduce((s, x) => s + (x.estimatedCommission ?? 0), 0);
      const weightedCommission = cards.reduce(
        (s, x) => s + (x.estimatedCommission ?? 0) * ((x.probabilityPct ?? 0) / 100),
        0
      );
      return {
        stage: c.stage,
        cards,
        count: cards.length,
        totalValue,
        weightedValue,
        totalCommission,
        weightedCommission,
      };
    });
    return { ...baseBoard, columns };
  }, [baseBoard, stageOverrides]);

  const handleCardMove = useCallback(
    async (dealId: string, targetStage: StageKey, fromStage: StageKey) => {
      setMoveError(null);
      // Optimistic
      setStageOverrides((prev) => ({ ...prev, [dealId]: targetStage }));

      try {
        const r = await fetch(`/api/deals/${dealId}/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: targetStage, sync_property: true }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${r.status}`);
        }
        // Server refresh pulls the canonical board state — clears
        // overrides via the new render.
        startTransition(() => router.refresh());
      } catch (err) {
        setMoveError(err instanceof Error ? err.message : String(err));
        // Revert
        setStageOverrides((prev) => {
          const next = { ...prev };
          delete next[dealId];
          return next;
        });
        // Keep fromStage referenced so the lint doesn't complain
        void fromStage;
      }
    },
    [router]
  );

  const handleCardClick = useCallback((deal: DealCardData) => {
    // Open the PROPERTY workspace as a peek panel. If the deal has
    // no property attached (rare for listing-side; happens with
    // buyer-rep without a target), do nothing — the deal-only path
    // still works from the deal-specific URL if the broker needs it.
    if (deal.property?.id) {
      setPeekPropertyId(deal.property.id);
    }
  }, []);

  // Flat list for the List view, tagged with the side each deal lives on.
  const listDeals = useMemo(() => {
    const pursuitIds = new Set(pursuits.columns.flatMap((c) => c.cards.map((x) => x.id)));
    return board.columns.flatMap((c) => c.cards).map((d) => ({
      ...d,
      side: (pursuitIds.has(d.id) ? "pursuits" : "listings") as "listings" | "pursuits",
    }));
  }, [board, pursuits]);

  // Derived stage health flags for the rail
  const staleCount = board.columns.flatMap((c) => c.cards).filter((c) => c.stale).length;
  const noProb = board.columns.flatMap((c) => c.cards).filter((c) => c.probabilityPct === null).length;
  const noClose = board.columns.flatMap((c) => c.cards).filter((c) => !c.expectedClose).length;

  const rail: RailSection[] = [
    {
      eyebrow: `Forecast — ${side}`,
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Active deals" value={board.totals.activeDeals.toString()} />
          <RailStat label="Pipeline value" value={fmtMoney(board.totals.pipelineValue)} />
          <RailStat label="Weighted (probability-adjusted)" value={fmtMoney(board.totals.weightedValue)} />
          <RailStat
            label="Avg probability"
            value={board.totals.avgProbability !== null ? Math.round(board.totals.avgProbability) + "%" : "—"}
          />
          <RailStat label="Closing within 90 days" value={fmtMoney(board.totals.expectedThisQuarter)} />
          {/* Commission rollups — brokerage's actual take-home forecast,
              not just pipeline value. Sum of estimated_commission per
              deal, weighted version uses each deal's probability. */}
          <div className="border-t border-white/[0.04] mt-2 pt-2">
            <RailStat
              label="Est. commission"
              value={fmtMoney(board.totals.pipelineCommission)}
            />
            <RailStat
              label="Weighted commission"
              value={fmtMoney(board.totals.weightedCommission)}
            />
          </div>
        </div>
      ),
    },
    {
      eyebrow: "Stage health",
      insights: [
        ...(staleCount > 0
          ? [{
              id: "stale",
              confidence: 100,
              headline: `${staleCount} deal${staleCount === 1 ? "" : "s"} stale in stage`,
              caption: "Time-in-stage past the SLA. Worth pinging or moving forward/back.",
              tone: "coral" as const,
            }]
          : []),
        ...(noProb > 0
          ? [{
              id: "no-prob",
              confidence: 100,
              headline: `${noProb} deal${noProb === 1 ? "" : "s"} missing probability`,
              caption: "Can't weight the forecast accurately without it.",
              tone: "amber" as const,
            }]
          : []),
        ...(noClose > 0
          ? [{
              id: "no-close",
              confidence: 100,
              headline: `${noClose} deal${noClose === 1 ? "" : "s"} missing expected close`,
              caption: "Set a target so the quarterly forecast holds.",
              tone: "amber" as const,
            }]
          : []),
        ...(staleCount + noProb + noClose === 0
          ? [{
              id: "clean",
              confidence: 100,
              headline: "Pipeline is clean",
              caption: "No stale deals, all probabilities + close dates set.",
              tone: "teal" as const,
            }]
          : []),
      ],
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <a
            href="/valuate"
            className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
          >
            Run a BOV → save as deal
          </a>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-end justify-between gap-x-6 gap-y-4 flex-wrap">
          <div className="min-w-[260px] flex-1">
            <Eyebrow tone="coral">Pipeline</Eyebrow>
            <h1 className="mt-1 font-display text-[30px] font-extrabold text-cream leading-none">The year</h1>
            <p className="mt-2 font-body text-[14px] text-cream-muted">
              These deals run six to eighteen months. This is where they are, when they land, and what they're worth.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 border-2 border-white/[0.10] p-1">
              <SideTab label="Board" active={view === "board"} onClick={() => chooseView("board")} />
              <SideTab label="List" active={view === "list"} onClick={() => chooseView("list")} />
            </div>
            <button
              onClick={() => setCreateOpen(true)}
              className="shrink-0 px-4 py-2.5 bg-copper-600 hover:bg-copper-700 font-heading text-[12px] font-semibold text-white transition-colors"
            >
              + Add deal
            </button>
          </div>
        </div>

        <PipelineScoreboard data={scoreboard} />

        {/* Side toggle */}
        <div ref={dealsRef} className="flex items-end justify-between gap-4 flex-wrap pt-2 scroll-mt-4">
          <div className="flex items-center gap-1 border-2 border-white/[0.10] p-1">
            <SideTab label={`Listings · ${listings.totals.activeDeals}`} active={side === "listings"} onClick={() => setSide("listings")} />
            <SideTab label={`Pursuits · ${pursuits.totals.activeDeals}`} active={side === "pursuits"} onClick={() => setSide("pursuits")} />
            <SideTab label={`All · ${allBoard.totals.activeDeals}`} active={side === "all"} onClick={() => setSide("all")} />
          </div>
          <span className="font-body text-[13px] text-cream-muted">
            {fmtMoney(board.totals.pipelineValue)} in play · {fmtMoney(board.totals.pipelineCommission)} fees · {fmtMoney(board.totals.weightedCommission)} weighted
          </span>
        </div>

        {/* Kanban */}
        <Panel
          eyebrow={view === "board" ? "Stage board" : "Deal list"}
          num={1}
          title={
            view === "list"
              ? `${board.totals.activeDeals} deal${board.totals.activeDeals === 1 ? "" : "s"}`
              : side === "listings" ? "Listings ladder" : side === "pursuits" ? "Pursuits ladder" : "Full ladder"
          }
          actions={
            <span className="hidden sm:inline font-mono text-[10px] text-cream-subtle">
              {view === "board" ? "Drag cards between stages · click for property" : "Tap a deal to open it"}
            </span>
          }
        >
          {moveError && (
            <div className="mb-3 rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
              Stage move failed: {moveError}
            </div>
          )}
          {view === "list" ? (
            <DealList deals={listDeals} />
          ) : board.totals.activeDeals === 0 ? (
            <div className="text-center py-12">
              <p className="font-body text-[13px] text-cream-subtle">
                No active {side === "all" ? "deals" : side}. New deals will land here as they're created.
              </p>
            </div>
          ) : (
            <KanbanBoard
              board={board}
              onCardMove={handleCardMove}
              onCardClick={handleCardClick}
            />
          )}
        </Panel>
      </div>
      <CreateDealDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        properties={candidates.properties.map((p) => ({ id: p.id, name: p.headline || p.name, city: p.city, state: p.state, status: p.status }))}
        contacts={candidates.contacts.map((c) => ({ id: c.id, fullName: c.name, email: c.email }))}
        defaultDealType={side === "pursuits" ? "buyer_rep" : "sale"}
      />
      {/* Property peek panel — slides in over the kanban so the
          stage ladder stays visible behind it. Clicking a deal
          card opens this; clicking the "Open full workspace" link
          inside it leaves the pipeline view entirely. */}
      <PropertyPeekPanel
        propertyId={peekPropertyId}
        onClose={() => setPeekPropertyId(null)}
      />
    </AppShell>
  );
}

function SideTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 font-heading text-[11px] uppercase tracking-eyebrow font-bold transition-colors ${
        active ? "bg-cream text-steward-base" : "text-cream-dim hover:text-cream"
      }`}
    >
      {label}
    </button>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold">{value}</span>
    </div>
  );
}
