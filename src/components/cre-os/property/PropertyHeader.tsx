"use client";

import { useState } from "react";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { StatusEditor } from "./StatusEditor";
import { EditPropertyDialog } from "./EditPropertyDialog";
import { LogActivityDialog } from "@/components/cre-os/activities/LogActivityDialog";
import { CreateTaskDialog } from "@/components/cre-os/tasks/CreateTaskDialog";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * PropertyHeader — sticky page-top frame for a property workspace. Holds the
 * masthead (name, address, stage/status badges) and a quick-action cluster.
 *
 * Visual language: editorial display title in serif, mono address, coral
 * accent line under the eyebrow. Status pills tell the reader the asset's
 * disposition at a glance.
 */
export function PropertyHeader({ p }: { p: PropertyDetail }) {
  const fullAddress = [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ");
  const statusTone = pillToneForStatus(p.status);
  const stageTone = pillToneForStage(p.pipelineStage);
  const [editOpen, setEditOpen] = useState(false);
  const [logActivityOpen, setLogActivityOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const valuationCaption = [
    p.askingPrice ? fmtMoney(p.askingPrice) : null,
    p.sqft ? `${p.sqft.toLocaleString()} SF` : null,
    p.capRate ? `${(p.capRate * 100).toFixed(2)}% cap` : null,
    p.occupancyPct ? `${(p.occupancyPct * 100).toFixed(0)}% occ` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bg-steward-base/80 backdrop-blur-md border-b border-white/[0.04] -mx-4 px-4 -mt-5 pt-5 pb-5 mb-6 lg:-mx-8 lg:px-8 lg:-mt-6 lg:pt-6">
      <Eyebrow tone="coral">
        {(p.assetType || "Property").toString().toUpperCase()}
        {p.transactionType && (
          <span className="ml-3 text-cream-subtle">
            ·  {p.transactionType.replace("_", " ").toUpperCase()}
          </span>
        )}
      </Eyebrow>

      <div className="mt-2 flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-medium text-3xl text-cream tracking-tight leading-tight">
            {p.name}
          </h1>
          {fullAddress && (
            <div className="mt-1 font-mono text-[11px] text-cream-dim uppercase tracking-wide">
              {fullAddress}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusEditor propertyId={p.id} currentStatus={p.status} />
            {p.pipelineStage && <StatusBadge tone={stageTone}>{p.pipelineStage}</StatusBadge>}
            {p.yourRole && (
              <span className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">
                · {p.yourRole.replace("_", " ")}
              </span>
            )}
          </div>

          {valuationCaption && (
            <div className="mt-2 font-mono text-[11px] text-cream-dim">{valuationCaption}</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Log activity — primary daily action; coral accent puts it
              ahead of Edit details and Run valuation. Opens a quick-capture
              modal that auto-attaches to this property. */}
          <button
            onClick={() => setLogActivityOpen(true)}
            className="px-3.5 py-2.5 lg:px-3 lg:py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] text-coral-300 hover:bg-coral-400/[0.20] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
            title="Log a call, meeting, tour, or note against this property."
          >
            + Log activity
          </button>
          <button
            onClick={() => setTaskOpen(true)}
            className="px-3.5 py-2.5 lg:px-3 lg:py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] text-coral-300 hover:bg-coral-400/[0.20] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
            title="Add a follow-up task against this property."
          >
            + Task
          </button>
          <button
            onClick={() => setEditOpen(true)}
            className="px-3.5 py-2.5 lg:px-3 lg:py-2 rounded border border-white/10 bg-white/[0.03] text-cream hover:bg-white/[0.06] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
            title="Edit address, pricing, sqft, NOI, cap rate, occupancy, parking, zoning, marketing copy, and notes."
          >
            Edit details
          </button>
          <a
            href={`/cre-os/valuate?address=${encodeURIComponent(fullAddress || p.name)}`}
            className="px-3.5 py-2.5 lg:px-3 lg:py-2 rounded border border-white/10 bg-white/[0.03] text-cream hover:bg-white/[0.06] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
          >
            Run valuation
          </a>
        </div>
      </div>
      <EditPropertyDialog open={editOpen} property={p} onClose={() => setEditOpen(false)} />
      <LogActivityDialog
        open={logActivityOpen}
        onClose={() => setLogActivityOpen(false)}
        propertyId={p.id}
        contextLabel={p.name}
      />
      <CreateTaskDialog
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        propertyId={p.id}
        contextLabel={p.name}
      />
    </div>
  );
}

function pillToneForStatus(s: string | null): "coral" | "teal" | "amber" | "neutral" {
  if (!s) return "neutral";
  const v = s.toLowerCase();
  if (v === "active" || v === "listed") return "coral";
  if (v === "leased" || v === "closed" || v === "sold") return "teal";
  if (v === "idea" || v === "draft") return "neutral";
  if (v === "at_risk" || v === "stale") return "amber";
  return "neutral";
}

function pillToneForStage(s: string | null): "coral" | "teal" | "amber" | "neutral" {
  if (!s) return "neutral";
  const v = s.toLowerCase();
  if (v.includes("closing")) return "teal";
  if (v.includes("loi") || v.includes("under contract") || v.includes("dd") || v.includes("due diligence")) return "amber";
  if (v.includes("listing") || v.includes("active")) return "coral";
  return "neutral";
}
