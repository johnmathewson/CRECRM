"use client";

import Link from "next/link";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { PipelineColumn, PipelinePropertyCard } from "@/app/cre-os/properties/pipeline/page";

/**
 * Property Pipeline kanban — properties grouped by lifecycle stage.
 *
 * Each column = one stage (Lead → Prospecting → Pitched → Listing →
 * Under Contract → Closed). Cards are mini-property summaries; click
 * to jump to the workspace where the Go-Live button + asset panels
 * live.
 *
 * No drag-and-drop in v1. Promotion happens on the property workspace
 * where the readiness check can live and the asset state can be
 * confirmed before flipping. This view is for visibility, not
 * mutation.
 */
export function PropertyPipelineView({ columns }: { columns: PipelineColumn[] }) {
  const totalActive = columns.reduce((s, c) => s + (c.key === "lead" ? 0 : c.cards.length), 0);

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
              {totalActive} active asset{totalActive === 1 ? "" : "s"} across the lifecycle (excluding Lead column)
            </p>
          </div>
          <Link
            href="/cre-os/properties"
            className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
          >
            Grid view ↗
          </Link>
        </header>

        {/* Horizontal scroll on small screens; multi-column at lg+ */}
        <div className="flex gap-4 overflow-x-auto pb-4 lg:overflow-x-visible lg:grid lg:grid-cols-6">
          {columns.map((col) => (
            <Column key={col.key} col={col} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Column({ col }: { col: PipelineColumn }) {
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
    <div className="w-72 lg:w-auto shrink-0 lg:shrink space-y-3">
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

      <div className="space-y-2 min-h-[60px]">
        {col.cards.length === 0 ? (
          <div className="rounded border border-white/[0.04] bg-white/[0.01] px-3 py-4 text-center">
            <p className="font-mono text-[10px] text-cream-subtle italic">empty</p>
          </div>
        ) : (
          col.cards.map((c) => <Card key={c.id} c={c} />)
        )}
      </div>
    </div>
  );
}

function Card({ c }: { c: PipelinePropertyCard }) {
  const fmtMoney = (n: number | null): string => {
    if (!n || !Number.isFinite(n) || n <= 0) return "—";
    if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
    if (n >= 1_000) return "$" + Math.round(n / 1_000) + "K";
    return "$" + n.toLocaleString();
  };
  return (
    <Link
      href={`/cre-os/properties/${c.slug}`}
      className="block rounded border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] p-3 transition-colors group"
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
