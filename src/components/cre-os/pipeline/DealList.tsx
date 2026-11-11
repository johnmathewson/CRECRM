"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { DealCardData } from "@/lib/cre-os/pipeline-queries";
import { getStageConfig, PIPELINE_LADDER } from "@/lib/cre-os/stage-config";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/** Lease deals usually store a $/SF rate in `price`; anything that size reads as a rate. */
function fmtValue(d: DealCardData): string {
  if (d.dealType === "lease" && d.price !== null && d.price > 0 && d.price < 1000) {
    return `$${d.price.toFixed(2)}/SF`;
  }
  return fmtMoney(d.price);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Explicit probability, else the stage default — same rule the board totals use. */
const effectiveProb = (d: DealCardData) => d.probabilityPct ?? getStageConfig(d.stage).defaultProbability;
const weightedFee = (d: DealCardData) =>
  d.estimatedCommission !== null ? d.estimatedCommission * (effectiveProb(d) / 100) : null;

type SortKey = "stage" | "close" | "value" | "fee" | "probability" | "age";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "stage", label: "Stage" },
  { key: "close", label: "Close date" },
  { key: "value", label: "Value" },
  { key: "fee", label: "Fee" },
  { key: "probability", label: "Probability" },
  { key: "age", label: "Days in stage" },
];

function compare(a: DealCardData, b: DealCardData, key: SortKey): number {
  // Missing values always sink to the bottom, whatever the key.
  const nullsLast = (x: number | null, y: number | null, dir: 1 | -1) => {
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * dir;
  };
  switch (key) {
    case "stage":
      return PIPELINE_LADDER.indexOf(b.stage) - PIPELINE_LADDER.indexOf(a.stage);
    case "close":
      return nullsLast(
        a.expectedClose ? new Date(a.expectedClose).getTime() : null,
        b.expectedClose ? new Date(b.expectedClose).getTime() : null,
        1,
      );
    case "value":
      return nullsLast(a.dealType === "lease" ? null : a.price, b.dealType === "lease" ? null : b.price, -1);
    case "fee":
      return nullsLast(a.estimatedCommission, b.estimatedCommission, -1);
    case "probability":
      return effectiveProb(b) - effectiveProb(a);
    case "age":
      return nullsLast(a.daysInStage, b.daysInStage, -1);
  }
}

/**
 * DealList — every open deal on one screen, as an alternative to the
 * kanban. Sortable; each row opens the deal page (where the forecast is
 * editable). Cards on mobile, a dense grid on desktop — no horizontal
 * scroll either way.
 */
export function DealList({ deals }: { deals: (DealCardData & { side: "listings" | "pursuits" })[] }) {
  const [sort, setSort] = useState<SortKey>("stage");
  const sorted = useMemo(() => [...deals].sort((a, b) => compare(a, b, sort)), [deals, sort]);

  if (deals.length === 0) {
    return (
      <p className="py-12 text-center font-body text-[13px] text-cream-subtle">
        No open deals. New deals will land here as they're created.
      </p>
    );
  }

  return (
    <div>
      {/* Sort chips */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Sort</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={`px-2.5 py-1 rounded border font-mono text-[10px] uppercase tracking-eyebrow transition-colors ${
              sort === s.key
                ? "border-coral-400/50 bg-coral-400/[0.12] text-coral-300"
                : "border-white/[0.08] bg-white/[0.02] text-cream-dim hover:text-cream"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Desktop header */}
      <div className="hidden lg:grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] gap-3 px-3 pb-2 border-b border-white/[0.06] font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">
        <span>Deal</span>
        <span>Stage</span>
        <span className="text-right">Value</span>
        <span className="text-right">Prob.</span>
        <span className="text-right">Est. fee</span>
        <span className="text-right">Weighted</span>
        <span className="text-right">Close</span>
      </div>

      <div className="space-y-2 lg:space-y-0">
        {sorted.map((d) => {
          const title = d.dealName ?? d.property?.name ?? d.contact?.fullName ?? "(unnamed deal)";
          const sub = [
            d.side === "pursuits" ? "Pursuit" : null,
            d.dealType ? d.dealType.replace("_", " ") : null,
            d.property?.city ?? null,
            d.contact?.fullName ?? null,
          ].filter(Boolean).join(" · ");
          const prob = d.probabilityPct !== null ? `${Math.round(d.probabilityPct)}%` : `${effectiveProb(d)}%*`;
          return (
            <Link
              key={d.id}
              href={`/cre-os/pipeline/${d.id}`}
              className={`block rounded-md lg:rounded-none border lg:border-0 lg:border-b border-white/[0.05] bg-steward-surface/40 lg:bg-transparent hover:bg-steward-surface/60 lg:hover:bg-white/[0.03] transition-colors p-3 border-l-2 lg:border-l-2 ${
                d.stale ? "border-l-coral-400" : "border-l-white/[0.05] lg:border-l-transparent"
              }`}
            >
              {/* Mobile card */}
              <div className="lg:hidden">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-heading text-[13px] font-semibold text-cream leading-snug">{title}</div>
                    {sub && <div className="mt-0.5 font-mono text-[10px] text-cream-subtle capitalize truncate">{sub}</div>}
                  </div>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-coral-300">
                    {getStageConfig(d.stage).label}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <MobileStat label="Value" value={fmtValue(d)} />
                  <MobileStat label="Prob." value={prob} />
                  <MobileStat label="Fee" value={fmtMoney(d.estimatedCommission)} />
                  <MobileStat label="Close" value={d.expectedClose ? fmtDate(d.expectedClose) : "—"} />
                </div>
                <Flags d={d} />
              </div>

              {/* Desktop row */}
              <div className="hidden lg:grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] gap-3 items-center">
                <div className="min-w-0">
                  <div className="font-heading text-[12.5px] font-semibold text-cream truncate">{title}</div>
                  {sub && <div className="font-mono text-[10px] text-cream-subtle capitalize truncate">{sub}</div>}
                </div>
                <div className="min-w-0">
                  <div className="font-body text-[12px] text-cream truncate">{getStageConfig(d.stage).label}</div>
                  <div className={`font-mono text-[10px] ${d.stale ? "text-coral-300" : "text-cream-subtle"}`}>
                    {d.daysInStage !== null ? `${d.daysInStage}d in stage` : "—"}
                  </div>
                </div>
                <span className="text-right font-mono text-[12px] text-cream">{fmtValue(d)}</span>
                <span className={`text-right font-mono text-[12px] ${d.probabilityPct === null ? "text-amber-300" : "text-cream"}`}>{prob}</span>
                <span className="text-right font-mono text-[12px] text-cream">{fmtMoney(d.estimatedCommission)}</span>
                <span className="text-right font-mono text-[12px] text-coral-300">{fmtMoney(weightedFee(d))}</span>
                <span className={`text-right font-mono text-[11px] ${d.expectedClose ? "text-cream" : "text-amber-300"}`}>
                  {d.expectedClose ? fmtDate(d.expectedClose) : "Not set"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {sorted.some((d) => d.probabilityPct === null) && (
        <p className="mt-3 font-body text-[10px] text-cream-subtle">* Stage default — no probability set on the deal.</p>
      )}
    </div>
  );
}

function MobileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="font-mono text-[11.5px] text-cream truncate">{value}</div>
    </div>
  );
}

function Flags({ d }: { d: DealCardData }) {
  const flags: { text: string; tone: string }[] = [];
  if (d.stale) flags.push({ text: `Stale · ${d.daysInStage}d in stage`, tone: "text-coral-300 border-coral-400/30" });
  if (!d.expectedClose) flags.push({ text: "No close date", tone: "text-amber-300 border-amber-400/30" });
  if (d.estimatedCommission === null) flags.push({ text: "No fee set", tone: "text-amber-300 border-amber-400/30" });
  if (flags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <span key={f.text} className={`px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-eyebrow ${f.tone}`}>
          {f.text}
        </span>
      ))}
    </div>
  );
}
