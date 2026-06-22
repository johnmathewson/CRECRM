"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * LifecycleAction — the property's "next forward step" CTA.
 *
 * Picks the correct next transition based on the property's CURRENT
 * status, and surfaces it as a single decisive button on the
 * PropertyHeader:
 *
 *   prospect / idea   → "Start Prospecting"
 *   prospecting       → "Mark as Pitched"
 *   pitched           → "Go Live"  ← readiness check + confirmation modal
 *   listed            → "Mark Under Contract"
 *   under_contract    → "Close Deal"
 *   sold / leased     → no action (already closed)
 *
 * The Go-Live transition is the only one that runs a server-side
 * readiness check (description, photos, asking price, etc.) before
 * allowing the write — other transitions go through cleanly with a
 * confirmation prompt.
 */

interface NextTransition {
  to: "prospecting" | "pitched" | "listed" | "under_contract" | "closed";
  buttonLabel: string;
  modalTitle: string;
  modalBody: string;
  primaryBg: string;
}

function nextTransition(status: string | null): NextTransition | null {
  switch (status) {
    case "prospect":
    case "idea":
      return {
        to: "prospecting",
        buttonLabel: "Start Prospecting",
        modalTitle: "Start prospecting this property",
        modalBody: "Flags the property as an active pursuit. You can run a BOV, contact the owner, and track the relationship from here.",
        primaryBg: "border-coral-400/50 bg-coral-400/[0.12] hover:bg-coral-400/[0.22] text-coral-300",
      };
    case "prospecting":
      return {
        to: "pitched",
        buttonLabel: "Mark as Pitched",
        modalTitle: "Mark this property as pitched",
        modalBody: "Records that you've presented the BOV / proposal to the owner. Stamps the pitched date for follow-up tracking.",
        primaryBg: "border-coral-400/50 bg-coral-400/[0.12] hover:bg-coral-400/[0.22] text-coral-300",
      };
    case "pitched":
      return {
        to: "listed",
        buttonLabel: "Go Live",
        modalTitle: "Promote to active listing",
        modalBody: "Flips status to Listed, stamps the list date, and publishes the property to the website. Steward will surface it in tomorrow's brief as newly listed.",
        primaryBg: "border-coral-400/50 bg-coral-400/[0.20] hover:bg-coral-400/[0.30] text-cream font-bold",
      };
    case "listed":
      return {
        to: "under_contract",
        buttonLabel: "Mark Under Contract",
        modalTitle: "Move to Under Contract",
        modalBody: "Records that an offer has been accepted. Stamps the UC date and moves the property to the Under Contract pipeline column.",
        primaryBg: "border-teal-400/50 bg-teal-400/[0.12] hover:bg-teal-400/[0.22] text-teal-300",
      };
    case "under_contract":
      return {
        to: "closed",
        buttonLabel: "Close Deal",
        modalTitle: "Close this deal",
        modalBody: "Marks the property as sold/closed. Stamps the close date. The property moves to the Closed pipeline column.",
        primaryBg: "border-teal-400/50 bg-teal-400/[0.12] hover:bg-teal-400/[0.22] text-teal-300",
      };
    default:
      return null;
  }
}

interface ReadinessGap {
  key: string;
  label: string;
  severity: "block" | "warn";
  message: string;
}

export function LifecycleAction({
  propertyId,
  currentStatus,
}: {
  propertyId: string;
  currentStatus: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gaps, setGaps] = useState<ReadinessGap[] | null>(null);
  const [, startTransition] = useTransition();

  const trans = nextTransition(currentStatus);
  if (!trans) return null; // closed / unknown state — no further forward action

  const isGoLive = trans.to === "listed";

  async function openModal() {
    setOpen(true);
    setError(null);
    setGaps(null);
    if (isGoLive) {
      // Dry-run to populate the readiness checklist before showing the
      // CTA — user sees what's missing right away.
      try {
        const r = await fetch(`/api/properties/${propertyId}/lifecycle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: trans!.to, dryRun: true }),
        });
        const j = await r.json();
        setGaps(j?.gaps ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function confirm(force = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: trans!.to, skipReadinessCheck: force }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Readiness failure surfaces here for Go-Live when not forced.
        if (j?.gaps) {
          setGaps(j.gaps);
          throw new Error(j?.reason === "readiness_check_failed" ? "Resolve the blockers below or click 'Force list anyway' to override." : j.error ?? `HTTP ${r.status}`);
        }
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const blockers = (gaps ?? []).filter((g) => g.severity === "block");
  const warnings = (gaps ?? []).filter((g) => g.severity === "warn");
  const ready = blockers.length === 0;

  return (
    <>
      <button
        onClick={openModal}
        className={`px-4 py-2.5 rounded border ${trans.primaryBg} font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors whitespace-nowrap`}
      >
        {trans.buttonLabel} →
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[110] flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto p-3 lg:p-12"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-steward-base border border-white/[0.08] rounded shadow-panel-soft flex flex-col max-h-[calc(100vh-1rem)] lg:max-h-[calc(100vh-6rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-white/[0.06] shrink-0">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
                Lifecycle · Next step
              </div>
              <h2 className="mt-1 font-heading text-lg font-semibold text-cream">
                {trans.modalTitle}
              </h2>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1 space-y-4">
              <p className="font-body text-[13px] text-cream-dim leading-relaxed">
                {trans.modalBody}
              </p>

              {isGoLive && gaps !== null && (
                <div className="space-y-3 pt-2">
                  <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
                    Readiness check
                  </div>

                  {ready && gaps.length === 0 && (
                    <div className="rounded border border-teal-400/40 bg-teal-400/[0.08] px-3 py-2 font-body text-[12px] text-teal-300">
                      All blockers cleared. Ready to go live.
                    </div>
                  )}

                  {blockers.length > 0 && (
                    <div className="rounded border border-coral-400/40 bg-coral-400/[0.08] p-3 space-y-2">
                      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300">
                        Blockers · {blockers.length}
                      </div>
                      <ul className="space-y-2">
                        {blockers.map((g) => (
                          <li key={g.key} className="font-body text-[12px]">
                            <div className="text-coral-300 font-semibold">✗ {g.label}</div>
                            <div className="text-cream-dim text-[11.5px] mt-0.5">{g.message}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {warnings.length > 0 && (
                    <div className="rounded border border-amber-400/30 bg-amber-400/[0.06] p-3 space-y-2">
                      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-amber-300">
                        Recommended · {warnings.length}
                      </div>
                      <ul className="space-y-2">
                        {warnings.map((g) => (
                          <li key={g.key} className="font-body text-[12px]">
                            <div className="text-amber-300 font-semibold">~ {g.label}</div>
                            <div className="text-cream-dim text-[11.5px] mt-0.5">{g.message}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-white/[0.06] shrink-0 bg-steward-base flex items-center justify-end gap-2 rounded-b">
              <button
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream disabled:opacity-50"
              >
                Cancel
              </button>
              {isGoLive && !ready && (
                <button
                  onClick={() => confirm(true)}
                  disabled={busy}
                  className="px-4 py-2 rounded border border-amber-400/40 bg-amber-400/[0.10] hover:bg-amber-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-amber-300 disabled:opacity-40"
                >
                  {busy ? "Listing…" : "Force list anyway"}
                </button>
              )}
              {(!isGoLive || ready) && (
                <button
                  onClick={() => confirm(false)}
                  disabled={busy || (isGoLive && gaps === null)}
                  className={`px-4 py-2 rounded border font-heading text-[11px] uppercase tracking-eyebrow font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${trans.primaryBg}`}
                >
                  {busy ? "Working…" : trans.buttonLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
