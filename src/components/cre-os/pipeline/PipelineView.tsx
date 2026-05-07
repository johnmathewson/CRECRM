"use client";

import { useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { KpiTile } from "@/components/cre-os/KpiTile";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import { KanbanBoard } from "./KanbanBoard";
import { CreateDealDialog } from "./CreateDealDialog";
import type { PipelineBoard } from "@/lib/cre-os/pipeline-queries";
import type { PortalCandidate, PortalContactCandidate } from "@/lib/cre-os/portal-queries";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * PipelineView — index page for /cre-os/pipeline. Two tabs (Listings vs
 * Pursuits), a horizontal kanban below, and a forecast/health rail.
 *
 * Server pre-loads both boards (parallel) so the tab toggle is instant.
 */
export function PipelineView({
  listings,
  pursuits,
  candidates,
}: {
  listings: PipelineBoard;
  pursuits: PipelineBoard;
  candidates: { properties: PortalCandidate[]; contacts: PortalContactCandidate[] };
}) {
  const [side, setSide] = useState<"listings" | "pursuits">("listings");
  const [createOpen, setCreateOpen] = useState(false);
  const board = side === "listings" ? listings : pursuits;

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
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            New deal <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Export forecast <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="coral">Pipeline</Eyebrow>
            <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Deal flow</h1>
            <p className="mt-1 font-body text-[13px] text-cream-dim">
              Two parallel ladders. Listings tracks sell-side / lease-side mandates. Pursuits tracks buy-side acquisitions.
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="shrink-0 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
          >
            + Add deal
          </button>
        </div>

        {/* Side toggle + KPIs */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 border border-white/[0.06] rounded-md p-1 bg-white/[0.02]">
            <SideTab label={`Listings · ${listings.totals.activeDeals}`} active={side === "listings"} onClick={() => setSide("listings")} />
            <SideTab label={`Pursuits · ${pursuits.totals.activeDeals}`} active={side === "pursuits"} onClick={() => setSide("pursuits")} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiTile
            label="Active deals"
            value={board.totals.activeDeals.toString()}
            caption={side === "listings" ? "Sell + lease side" : "Buy side"}
          />
          <KpiTile
            label="Pipeline value"
            value={fmtMoney(board.totals.pipelineValue)}
            caption="Sum of asking / offer"
          />
          <KpiTile
            label="Weighted forecast"
            value={fmtMoney(board.totals.weightedValue)}
            caption="× probability"
          />
          <KpiTile
            label="Closing 90d"
            value={fmtMoney(board.totals.expectedThisQuarter)}
            caption="Expected close ≤ 90 days"
          />
        </div>

        {/* Kanban */}
        <Panel
          eyebrow="Stage board"
          num={1}
          title={side === "listings" ? "Listings ladder" : "Pursuits ladder"}
          actions={
            <span className="font-mono text-[10px] text-cream-subtle">
              Scroll horizontally — full ladder visible
            </span>
          }
        >
          {board.totals.activeDeals === 0 ? (
            <div className="text-center py-12">
              <p className="font-body text-[13px] text-cream-subtle">
                No active {side === "listings" ? "listings" : "pursuits"}. New deals will land here as they're created.
              </p>
            </div>
          ) : (
            <KanbanBoard board={board} />
          )}
        </Panel>
      </div>
      <CreateDealDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        properties={candidates.properties.map((p) => ({ id: p.id, name: p.name, city: p.city, state: p.state }))}
        contacts={candidates.contacts.map((c) => ({ id: c.id, fullName: c.name, email: c.email }))}
        defaultDealType={side === "pursuits" ? "buyer_rep" : "sale"}
      />
    </AppShell>
  );
}

function SideTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded font-heading text-[11px] uppercase tracking-eyebrow font-semibold transition-colors ${
        active ? "bg-coral-400 text-steward-base" : "text-cream-dim hover:text-cream"
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
