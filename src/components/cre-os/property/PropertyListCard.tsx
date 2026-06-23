"use client";

import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { ArchivePropertyDialog } from "./ArchivePropertyDialog";
import type { PropertyCard } from "@/lib/cre-os/property-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * PropertyListCard — single asset card on the inventory grid.
 *
 * Three distinct information layers, separated visually:
 *   • Lifecycle (top-right): status + stage. What kind of asset is this?
 *   • Stats (mid): asking, SF, NOI, cap. Hard facts.
 *   • Intelligence (bottom): what's happening now? Activity line + signal
 *     badges (hot, quiet, stale, missing val) + next-action chip.
 *
 * Visual urgency cue: coral left-bar when priorityScore > 0; muted left-bar
 * when calm. Lets the broker scan the grid for "what matters today".
 */
export function PropertyListCard({
  p,
  onPeek,
  archivedView = false,
  onRestored,
}: {
  p: PropertyCard;
  /** When provided, a card click opens the peek panel instead of
   *  navigating to the workspace. Right-click / cmd+click still
   *  open the workspace in a new tab via the underlying href. */
  onPeek?: (id: string) => void;
  /** True on /cre-os/properties?archived=1. Hides the archive menu
   *  and shows a Restore action instead. */
  archivedView?: boolean;
  /** Called after a successful restore so the parent can refresh
   *  the list (the restored property should leave the archived view). */
  onRestored?: () => void;
}) {
  const fullAddress = [p.address, p.city, p.state].filter(Boolean).join(", ");
  const statusTone = pillToneForStatus(p.status);
  const stageTone = pillToneForStage(p.pipelineStage);
  const urgent = p.priorityScore >= 3;
  const warm = p.priorityScore >= 1 && p.priorityScore < 3;
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  async function restore(e: React.MouseEvent) {
    // The card's <a> would otherwise navigate. Restoring stays on
    // this archived view so the broker can keep working through it.
    e.preventDefault();
    e.stopPropagation();
    if (restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const r = await fetch(`/api/properties/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_dead: false, dead_reason: null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      onRestored?.();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : String(err));
      setRestoring(false);
    }
  }
  const [hidden, setHidden] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside-click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Optimistically hide on archive — feels instant, parent refresh will
  // reconcile when the page re-fetches.
  if (hidden) return null;

  const cardBorder = urgent
    ? "border-l-2 border-l-coral-400 border-y border-r border-y-white/[0.06] border-r-white/[0.06]"
    : warm
      ? "border-l-2 border-l-amber/60 border-y border-r border-y-white/[0.05] border-r-white/[0.05]"
      : "border border-white/[0.05]";

  return (
    <a
      href={`/cre-os/properties/${p.slug}`}
      onClick={(e) => {
        // Plain left-click → peek panel. Modifier-clicks (cmd/ctrl/
        // middle) and right-click fall through to the href so the
        // broker can still open in a new tab when they want.
        if (!onPeek) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onPeek(p.id);
      }}
      className={`block group relative bg-steward-mid/50 hover:bg-steward-mid/80 rounded-md transition-all ${cardBorder} hover:border-coral-400/30`}
    >
      <div className="p-5">
        {/* Header — eyebrow + name + address + lifecycle pills */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="coral">
              {(p.assetType || "Property").toUpperCase()}
              {p.transactionType && (
                <span className="ml-2 text-cream-subtle">·  {p.transactionType.replace("_", " ").toUpperCase()}</span>
              )}
            </Eyebrow>
            <h3 className="mt-1 font-display font-medium text-lg text-cream tracking-tight group-hover:text-coral-300 transition-colors leading-snug">
              {p.name}
            </h3>
            {fullAddress && (
              <div className="mt-0.5 font-mono text-[10px] text-cream-subtle uppercase tracking-wide truncate">
                {fullAddress}
              </div>
            )}
          </div>

          {/* Lifecycle badges — what KIND of asset is this */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {p.status && <StatusBadge size="xs" tone={statusTone}>{p.status.replace("_", " ")}</StatusBadge>}
            {p.pipelineStage && <StatusBadge size="xs" tone={stageTone}>{p.pipelineStage}</StatusBadge>}
          </div>
        </div>

        {/* Stats row — hard facts */}
        <div className="mt-4 grid grid-cols-4 gap-x-4 gap-y-2">
          <Stat label="Asking" value={fmtMoney(p.askingPrice)} />
          <Stat label="SF" value={p.sqft ? p.sqft.toLocaleString() : "—"} />
          <Stat label="NOI" value={fmtMoney(p.noi)} />
          <Stat label="Cap" value={p.capRate ? (p.capRate * 100).toFixed(2) + "%" : "—"} />
        </div>
      </div>

      {/* Corner overlay. On the active view: kebab → Archive. On the
          archived view: a direct Restore button (no menu — the only
          relevant action on an archive is bringing it back). */}
      {archivedView ? (
        <div className="absolute top-2 right-2 z-10">
          <button
            type="button"
            onClick={restore}
            disabled={restoring}
            title="Restore to active inventory"
            className="px-2.5 py-1 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.22] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-teal-300 transition-colors disabled:opacity-40"
          >
            {restoring ? "Restoring…" : "↺ Restore"}
          </button>
          {restoreError && (
            <div className="absolute right-0 top-full mt-1 w-56 px-2.5 py-1.5 rounded border border-red-400/40 bg-red-500/[0.08] font-body text-[11px] text-red-300">
              {restoreError}
            </div>
          )}
        </div>
      ) : (
        <div className="absolute top-2 right-2 z-10" ref={menuRef}>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded border border-white/[0.08] bg-steward-base/80 hover:bg-steward-mid text-cream-subtle hover:text-cream"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-44 rounded border border-white/[0.10] bg-steward-base shadow-panel-soft overflow-hidden"
            >
              <button
                role="menuitem"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen(false);
                  setArchiveOpen(true);
                }}
                className="block w-full text-left px-3.5 py-2.5 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-400 hover:bg-coral-500/[0.10] transition-colors"
              >
                Archive property
              </button>
            </div>
          )}
        </div>
      )}

      {/* Intelligence band — what's happening NOW */}
      {(p.priorityScore > 0 || p.daysSinceTouch !== null) && (
        <div className="px-5 py-3 border-t border-white/[0.04] bg-black/20">
          {/* Activity line */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <ActivityLine p={p} />
            <IntelligenceBadges p={p} />
          </div>

          {/* Next action */}
          {p.nextAction && (
            <div className={`inline-flex items-center gap-1 font-heading text-[10px] font-semibold uppercase tracking-eyebrow ${urgent ? "text-coral-300" : warm ? "text-amber" : "text-cream-dim"}`}>
              → {p.nextAction}
            </div>
          )}
        </div>
      )}

      {/* Archive dialog — portal-rendered so the card's <a> doesn't trap
          the fixed overlay. Hides this card optimistically on success
          while the parent list re-fetches. */}
      <ArchivePropertyDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        propertyId={p.id}
        propertyName={p.name}
        propertyAddress={fullAddress || null}
        onArchived={() => setHidden(true)}
      />
    </a>
  );
}

function ActivityLine({ p }: { p: PropertyCard }) {
  if (p.daysSinceTouch === null) {
    return <span className="font-mono text-[10px] text-cream-subtle">No activity logged</span>;
  }
  const label =
    p.daysSinceTouch === 0 ? "Touched today"
    : p.daysSinceTouch === 1 ? "Touched yesterday"
    : `Last touched ${p.daysSinceTouch}d ago`;
  return <span className="font-mono text-[10px] text-cream-subtle truncate">{label}</span>;
}

function IntelligenceBadges({ p }: { p: PropertyCard }) {
  const badges: Array<{ label: string; tone: "coral" | "amber" | "neutral" }> = [];
  if (p.hotLeads > 0) badges.push({ label: `${p.hotLeads} hot`, tone: "coral" });
  if (p.overdueTasks > 0) badges.push({ label: `${p.overdueTasks} overdue`, tone: "coral" });
  if (p.isStale) badges.push({ label: "Stale", tone: "amber" });
  else if (p.isQuiet) badges.push({ label: "Quiet", tone: "neutral" });
  if (p.isMissingValuation) badges.push({ label: "No BOV", tone: "amber" });
  if (badges.length === 0 && p.openTasks > 0) {
    badges.push({ label: `${p.openTasks} task${p.openTasks === 1 ? "" : "s"}`, tone: "neutral" });
  }
  if (!badges.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {badges.slice(0, 3).map((b, i) => (
        <StatusBadge key={i} size="xs" tone={b.tone}>{b.label}</StatusBadge>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-[12px] text-cream font-medium">{value}</div>
    </div>
  );
}

function pillToneForStatus(s: string | null): "coral" | "teal" | "amber" | "neutral" {
  if (!s) return "neutral";
  const v = s.toLowerCase();
  if (v === "active" || v === "listed") return "coral";
  if (v === "leased" || v === "closed" || v === "sold") return "teal";
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
