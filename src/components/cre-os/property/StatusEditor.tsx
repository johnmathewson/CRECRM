"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import {
  PROPERTY_STATUS_ORDER,
  PROPERTY_STATUS_META,
  type PropertyStatus,
} from "@/lib/cre-os/property-status";

/**
 * StatusEditor — clickable status pill on the property workspace masthead.
 * Hovers shows the status as a chip; clicking opens a popover with the
 * picker. Selecting a new status hits /api/properties/[id]/status which
 * also advances the paired deal in lockstep so pipeline stays consistent.
 *
 * Keeps the visual language of `<StatusBadge />` so it doesn't look out of
 * place when read-only.
 */
export function StatusEditor({
  propertyId,
  currentStatus,
  className = "",
}: {
  propertyId: string;
  currentStatus: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const display = optimistic ?? currentStatus ?? "idea";
  const meta = (display in PROPERTY_STATUS_META)
    ? PROPERTY_STATUS_META[display as PropertyStatus]
    : { label: display, tone: "neutral" as const, hint: "" };

  async function pickStatus(s: PropertyStatus) {
    if (s === display) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    setOptimistic(s);
    try {
      const res = await fetch(`/api/properties/${propertyId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: s }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      setOptimistic(null);
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className={`relative inline-flex items-center ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="group inline-flex items-center gap-1.5 disabled:opacity-50"
        aria-label="Change status"
      >
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-3 h-3 text-cream-subtle group-hover:text-cream transition-colors"
        >
          <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 top-full left-0 mt-2 min-w-[280px] rounded border border-white/[0.08] bg-steward-base shadow-panel-soft overflow-hidden">
          <div className="px-3 py-2 border-b border-white/[0.04] font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">
            Change status
          </div>
          <div className="max-h-[300px] overflow-y-auto py-1">
            {PROPERTY_STATUS_ORDER.map((s) => {
              const m = PROPERTY_STATUS_META[s];
              const isCurrent = s === display;
              return (
                <button
                  key={s}
                  onClick={() => pickStatus(s)}
                  disabled={busy}
                  className={`w-full text-left px-3 py-2 transition-colors flex items-start gap-2.5 ${
                    isCurrent
                      ? "bg-coral-400/[0.08]"
                      : "hover:bg-white/[0.04]"
                  } disabled:opacity-50`}
                >
                  <StatusBadge tone={m.tone} size="xs">{m.label}</StatusBadge>
                  <div className="min-w-0 flex-1">
                    <div className="font-body text-[11px] text-cream-dim leading-snug">{m.hint}</div>
                  </div>
                  {isCurrent && (
                    <span className="font-mono text-[9px] text-coral-400 mt-0.5">CURRENT</span>
                  )}
                </button>
              );
            })}
          </div>
          {error && (
            <div className="px-3 py-2 border-t border-red-400/20 bg-red-500/[0.06] font-body text-[10px] text-red-300">
              {error}
            </div>
          )}
          <div className="px-3 py-2 border-t border-white/[0.04] font-body text-[9px] text-cream-subtle">
            Stage on the paired deal advances automatically when you move the property forward.
          </div>
        </div>
      )}
    </div>
  );
}
