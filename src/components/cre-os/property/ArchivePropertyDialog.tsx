"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/**
 * ArchivePropertyDialog — confirm dialog for soft-deleting a property.
 *
 * Soft delete only: this calls DELETE /api/properties/[id] which sets
 * is_dead=true. The property disappears from active lists (which all
 * filter is_dead=false) but every tied record — deals, leads, comms,
 * sale_comps, listing_metrics — stays intact. Reversal is a PATCH
 * { is_dead: false }; we don't expose that UI yet, but the data is
 * there.
 *
 * Portal-rendered to document.body so the parent's backdrop-blur
 * (PropertyHeader is sticky + blurred) doesn't trap the fixed-position
 * overlay — same fix we applied to BuyerFitDialog.
 *
 * After successful archive, navigates back to /cre-os/listings since
 * staying on the workspace would show a now-archived property.
 */
export function ArchivePropertyDialog({
  open,
  onClose,
  propertyId,
  propertyName,
  propertyAddress,
  onArchived,
}: {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  propertyName: string;
  propertyAddress: string | null;
  /**
   * If provided, called after a successful archive instead of navigating
   * to /cre-os/listings. Use from card-level archive (where the parent
   * list will refresh in place) — leave undefined when archiving from
   * the property workspace, which redirects away.
   */
  onArchived?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  if (typeof window === "undefined") return null;

  async function handleArchive() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "archived_by_user" }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      onClose();
      if (onArchived) {
        onArchived();
        router.refresh();
      } else {
        router.push("/cre-os/listings");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
            Archive property
          </div>
          <h2 className="mt-0.5 font-heading text-base font-semibold text-cream">
            Archive {propertyName}?
          </h2>
          {propertyAddress && (
            <p className="mt-0.5 font-mono text-[10.5px] text-cream-subtle">{propertyAddress}</p>
          )}
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="font-body text-[12.5px] text-cream-dim leading-relaxed">
            This property disappears from your active lists. Tied history
            — deals, leads, communications, comps — stays intact and the
            archive is reversible. Use this when a property is sold,
            taken off market, or was added by mistake.
          </p>
          {error && (
            <div className="rounded border border-coral-400/40 bg-coral-400/[0.08] px-3 py-2 font-body text-[11.5px] text-coral-300">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleArchive}
            disabled={busy}
            className="px-4 py-2 rounded border border-coral-400/50 bg-coral-400/[0.15] hover:bg-coral-400/[0.25] disabled:opacity-40 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300"
          >
            {busy ? "Archiving…" : "Archive property"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
