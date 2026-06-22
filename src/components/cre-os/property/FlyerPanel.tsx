"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * FlyerPanel — 1-page property flyer generator + download.
 *
 * Same shape as OmPanel. Uses the live marketing copy + the property's
 * photos. The flyer pulls the hero image from properties.images[0],
 * so the broker should upload photos via the Property photos panel
 * first.
 */
export function FlyerPanel({
  propertyId,
  flyerPdfUrl,
  flyerGeneratedAt,
  imageCount,
}: {
  propertyId: string;
  flyerPdfUrl: string | null;
  flyerGeneratedAt: string | null;
  imageCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function generateFlyer() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}/marketing/flyer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const noPhotos = imageCount === 0;

  if (!flyerPdfUrl) {
    return (
      <div className="space-y-4">
        <div className="rounded border border-white/[0.06] bg-white/[0.02] px-4 py-5">
          <p className="font-body text-[13px] text-cream-dim">
            No flyer generated yet.
          </p>
          <p className="font-body text-[11.5px] text-cream-subtle mt-1 leading-relaxed">
            One-page flyer: hero photo, property name, key stats strip, investment highlights, property
            facts, and broker contact. Pulls the hero image from the first photo on this property.
          </p>
          {noPhotos && (
            <p className="font-body text-[11.5px] text-coral-300 mt-2">
              ⚠ No photos uploaded yet — flyer will render with a teal placeholder band instead of a hero
              image. Add photos in panel #5 first for the full effect.
            </p>
          )}
        </div>
        {error && (
          <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11.5px] text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={generateFlyer} disabled={busy} className={btnPrimary}>
            {busy ? "Generating Flyer…" : "Generate Flyer"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-teal-400/30 bg-teal-400/[0.04] px-4 py-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300">
              Property Flyer
            </div>
            <div className="font-heading text-[14px] text-cream mt-0.5">
              Generated {flyerGeneratedAt ? formatRelative(flyerGeneratedAt) : "—"}
            </div>
          </div>
          <a
            href={flyerPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded border border-teal-400/50 bg-teal-400/[0.12] hover:bg-teal-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-teal-300 whitespace-nowrap"
          >
            Open Flyer ↗
          </a>
        </div>
        <p className="font-body text-[11.5px] text-cream-subtle">
          The flyer uses your current marketing copy + the first photo on the property. Update either
          and regenerate to refresh.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11.5px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
        <button onClick={generateFlyer} disabled={busy} className={btnPrimary}>
          {busy ? "Regenerating…" : "Regenerate Flyer"}
        </button>
        <a
          href={flyerPdfUrl}
          download
          className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
        >
          Download
        </a>
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const btnPrimary =
  "px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed";
