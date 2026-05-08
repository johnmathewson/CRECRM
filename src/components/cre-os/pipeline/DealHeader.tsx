"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { LogActivityDialog } from "@/components/cre-os/activities/LogActivityDialog";
import { getStageConfig } from "@/lib/cre-os/stage-config";
import type { DealDetail } from "@/lib/cre-os/pipeline-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * DealHeader — masthead for /cre-os/pipeline/[id]. Mirrors the property
 * workspace header in shape: eyebrow + display title, mono caption, status
 * pills, key numbers, action cluster.
 */
export function DealHeader({ d }: { d: DealDetail }) {
  const cfg = getStageConfig(d.stage);
  const [logActivityOpen, setLogActivityOpen] = useState(false);
  const title = d.dealName ?? d.property?.name ?? d.contact?.fullName ?? "(unnamed deal)";
  const subline = [
    d.property?.address ? [d.property.address, d.property.city, d.property.state].filter(Boolean).join(", ") : null,
    d.contact?.email ?? null,
    d.dealType ? d.dealType.replace("_", " ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const valuationCaption = [
    d.price ? fmtMoney(d.price) : null,
    d.commissionPct ? `${(d.commissionPct * 100).toFixed(2)}% comm` : null,
    d.estimatedCommission ? `est. comm ${fmtMoney(d.estimatedCommission)}` : null,
    d.expectedClose ? `target close ${d.expectedClose}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bg-steward-base/80 backdrop-blur-md border-b border-white/[0.04] -mx-4 px-4 -mt-5 pt-5 pb-5 mb-6 lg:-mx-8 lg:px-8 lg:-mt-6 lg:pt-6">
      <Eyebrow tone="coral">
        Deal · {d.dealType ? d.dealType.replace("_", " ").toUpperCase() : "—"}
      </Eyebrow>

      <div className="mt-2 flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-medium text-3xl text-cream tracking-tight leading-tight">{title}</h1>
          {subline && (
            <div className="mt-1 font-mono text-[11px] text-cream-dim uppercase tracking-wide truncate">
              {subline}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge tone={cfg.tone === "neutral" ? "neutral" : cfg.tone}>
              {cfg.label}
            </StatusBadge>
            {d.daysInCurrentStage !== null && (
              <span className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">
                · {d.daysInCurrentStage} day{d.daysInCurrentStage === 1 ? "" : "s"} in stage
              </span>
            )}
            {d.probabilityPct !== null && (
              <span className="font-mono text-[10px] text-cream-dim">
                · {Math.round(d.probabilityPct)}% probability
              </span>
            )}
            {d.isClosed && <StatusBadge tone="teal">Closed</StatusBadge>}
            {d.isDead && <StatusBadge tone="neutral">Dead{d.deadReason ? ` · ${d.deadReason}` : ""}</StatusBadge>}
          </div>

          {valuationCaption && (
            <div className="mt-2 font-mono text-[11px] text-cream-dim">{valuationCaption}</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Log activity — primary daily action; the stage stepper below
              the masthead handles the actual advance. The 'Advance stage'
              button here was a stub anyway (real advances happen via the
              clickable stepper) so we drop it for the higher-value action. */}
          <button
            onClick={() => setLogActivityOpen(true)}
            className="px-3 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] text-coral-300 hover:bg-coral-400/[0.20] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
            title="Log a call, meeting, tour, or note against this deal."
          >
            + Log activity
          </button>
          {d.property && (
            <a
              href={`/cre-os/properties/${d.property.slug}`}
              className="px-3 py-2 rounded border border-white/10 bg-white/[0.03] text-cream hover:bg-white/[0.06] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
            >
              Open property →
            </a>
          )}
        </div>
      </div>
      <LogActivityDialog
        open={logActivityOpen}
        onClose={() => setLogActivityOpen(false)}
        dealId={d.id}
        contactId={d.contact?.id}
        propertyId={d.property?.id}
        contextLabel={d.dealName ?? d.property?.name ?? d.contact?.fullName ?? "this deal"}
      />
    </div>
  );
}
