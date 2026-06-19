"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * OmPanel — Offering Memorandum generator + download surface.
 *
 * Lives on the property workspace next to the listing-copy panel.
 * Three states:
 *   - NEVER GENERATED: shows "Generate OM" CTA + a one-liner about
 *     what the OM pulls from (property + investment highlights +
 *     description).
 *   - GENERATED: shows download link, generated-at timestamp, +
 *     "Regenerate" button.
 *   - GENERATING: spinner state during the API call.
 *
 * Regenerate overwrites om_pdf_url with the new URL; the previous
 * file stays in Storage so any links you already shared still work.
 *
 * The OM pulls the LIVE description / highlights / investment_highlights
 * — so to update the OM, John updates the marketing copy (which uses
 * its own preview-then-save flow), then clicks Regenerate here.
 */
export function OmPanel({
  propertyId,
  omPdfUrl,
  omGeneratedAt,
}: {
  propertyId: string;
  omPdfUrl: string | null;
  omGeneratedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function generateOm() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}/marketing/om`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      // Refresh the workspace so the new omPdfUrl flows in.
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!omPdfUrl) {
    return (
      <div className="space-y-4">
        <div className="rounded border border-white/[0.06] bg-white/[0.02] px-4 py-5">
          <p className="font-body text-[13px] text-cream-dim">
            No OM generated yet.
          </p>
          <p className="font-body text-[11.5px] text-cream-subtle mt-1 leading-relaxed">
            The generator pulls the property facts, your description, both highlight sets, and your voice
            profile into a multi-page PDF: cover, executive summary, property overview, financial summary,
            location, contact &amp; disclaimer.
          </p>
        </div>
        {error && (
          <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11.5px] text-red-300">
            {error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={generateOm} disabled={busy} className={btnPrimary}>
            {busy ? "Generating OM…" : "Generate OM"}
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
              Offering Memorandum
            </div>
            <div className="font-heading text-[14px] text-cream mt-0.5">
              Generated {omGeneratedAt ? formatRelative(omGeneratedAt) : "—"}
            </div>
          </div>
          <a
            href={omPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-2 rounded border border-teal-400/50 bg-teal-400/[0.12] hover:bg-teal-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-teal-300 whitespace-nowrap"
          >
            Open OM ↗
          </a>
        </div>
        <p className="font-body text-[11.5px] text-cream-subtle">
          The OM uses your current description, highlights, and investment highlights. If you change those,
          regenerate to refresh the PDF.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11.5px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
        <button onClick={generateOm} disabled={busy} className={btnPrimary}>
          {busy ? "Regenerating…" : "Regenerate OM"}
        </button>
        <a
          href={omPdfUrl}
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
