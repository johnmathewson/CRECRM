"use client";

import { useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { StatusEditor } from "./StatusEditor";
import { EditPropertyDialog } from "./EditPropertyDialog";
import { LogActivityDialog } from "@/components/cre-os/activities/LogActivityDialog";
import { CreateTaskDialog } from "@/components/cre-os/tasks/CreateTaskDialog";
import { BuyerFitDialog } from "@/components/cre-os/property/BuyerFitDialog";
import { ArchivePropertyDialog } from "@/components/cre-os/property/ArchivePropertyDialog";
import { LifecycleAction } from "@/components/cre-os/property/LifecycleAction";
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
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [buyerFitOpen, setBuyerFitOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the mobile action menu on outside-click or Escape.
  useEffect(() => {
    if (!actionMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActionMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActionMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [actionMenuOpen]);

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
            <span className="ml-1">
              <LifecycleAction propertyId={p.id} currentStatus={p.status} />
            </span>
          </div>

          {valuationCaption && (
            <div className="mt-2 font-mono text-[11px] text-cream-dim">{valuationCaption}</div>
          )}
        </div>

        {/* Mobile (< md): collapse the 4 actions behind a single "Actions"
            menu so the header doesn't wrap into two cluttered rows. The
            full button row stays visible at md+ where there's space. */}
        <div className="shrink-0">
          {/* Mobile menu */}
          <div className="md:hidden relative" ref={menuRef}>
            <button
              onClick={() => setActionMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={actionMenuOpen}
              className="px-4 py-2.5 rounded border border-coral-400/40 bg-coral-400/[0.10] text-coral-300 hover:bg-coral-400/[0.20] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors flex items-center gap-2"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              Actions
            </button>
            {actionMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 z-30 w-56 rounded border border-white/[0.10] bg-steward-base shadow-panel-soft overflow-hidden"
              >
                <MenuItem onClick={() => { setLogActivityOpen(true); setActionMenuOpen(false); }} tone="coral">+ Log activity</MenuItem>
                <MenuItem onClick={() => { setTaskOpen(true); setActionMenuOpen(false); }} tone="coral">+ Task</MenuItem>
                <MenuItem onClick={() => { setBuyerFitOpen(true); setActionMenuOpen(false); }} tone="coral">Buyer-fit PDF</MenuItem>
                <MenuItem onClick={() => { setEditOpen(true); setActionMenuOpen(false); }}>Edit details</MenuItem>
                <a
                  role="menuitem"
                  href={`/cre-os/valuate?address=${encodeURIComponent(fullAddress || p.name)}`}
                  onClick={() => setActionMenuOpen(false)}
                  className="block w-full text-left px-4 py-3 font-heading text-[12px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:bg-white/[0.04] hover:text-cream transition-colors"
                >
                  Run valuation
                </a>
                <div className="border-t border-white/[0.06]">
                  <MenuItem onClick={() => { setArchiveOpen(true); setActionMenuOpen(false); }} tone="danger">Archive property</MenuItem>
                </div>
              </div>
            )}
          </div>

          {/* Desktop: full row, inline */}
          <div className="hidden md:flex items-center gap-2 flex-wrap">
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
              onClick={() => setBuyerFitOpen(true)}
              className="px-3.5 py-2.5 lg:px-3 lg:py-2 rounded border border-teal-400/40 bg-teal-400/[0.08] text-teal-300 hover:bg-teal-400/[0.18] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
              title="Generate a 1-page buyer-fit PDF assessment matching this property to a specific buyer's criteria."
            >
              Buyer-fit PDF
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
            {/* Visual separator from constructive actions, then the
                destructive Archive button. Keeps it discoverable without
                making it the first thing clicked. */}
            <div className="hidden lg:block w-px h-6 bg-white/[0.08] mx-1" aria-hidden="true" />
            <button
              onClick={() => setArchiveOpen(true)}
              className="px-3.5 py-2.5 lg:px-3 lg:py-2 rounded border border-coral-500/30 bg-coral-500/[0.05] text-coral-400 hover:bg-coral-500/[0.15] hover:border-coral-400/50 font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
              title="Archive this property. Soft delete — disappears from active lists, history stays intact, reversible."
            >
              Archive
            </button>
          </div>
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
      <BuyerFitDialog
        open={buyerFitOpen}
        onClose={() => setBuyerFitOpen(false)}
        propertyId={p.id}
        propertyName={p.name}
      />
      <ArchivePropertyDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        propertyId={p.id}
        propertyName={p.name}
        propertyAddress={fullAddress || null}
      />
    </div>
  );
}

function MenuItem({
  onClick,
  children,
  tone = "default",
}: {
  onClick: () => void;
  children: React.ReactNode;
  tone?: "default" | "coral" | "danger";
}) {
  const color =
    tone === "coral"
      ? "text-coral-300 hover:bg-coral-400/[0.08]"
      : tone === "danger"
        ? "text-coral-400 hover:bg-coral-500/[0.10]"
        : "text-cream-dim hover:bg-white/[0.04] hover:text-cream";
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`block w-full text-left px-4 py-3 font-heading text-[12px] uppercase tracking-eyebrow font-semibold transition-colors border-b border-white/[0.04] last:border-b-0 ${color}`}
    >
      {children}
    </button>
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
