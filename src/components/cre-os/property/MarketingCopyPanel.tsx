"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eyebrow } from "@/components/cre-os/Eyebrow";

/**
 * MarketingCopyPanel — the read/edit/regenerate surface for the listing
 * description generator. Lives on the property workspace Overview tab.
 *
 * State machine (single component, three modes):
 *   - VIEW (default): shows the currently-saved headline/description/
 *     highlights from the DB. Buttons: [Generate with AI] [Edit].
 *   - EDIT: textareas + inputs for manual tweak. Buttons: [Save] [Cancel].
 *   - PREVIEW (after Generate): shows the just-generated payload before
 *     committing. Buttons: [Save this version] [Regenerate] [Cancel].
 *
 * Generate calls POST /api/properties/[id]/marketing/generate with
 * dryRun:true so the new payload doesn't overwrite the saved version
 * until John explicitly clicks Save.
 *
 * Future generators (flyer, OM, social) live as separate sibling
 * panels — same shape, different asset key.
 */

type Mode = "view" | "edit" | "preview";

interface PreviewPayload {
  headline: string;
  description: string;
  highlights: string[];
  observations?: string[];
}

interface ContextSummary {
  sale_comps_used: number;
  lease_comps_used: number;
  median_sale_ppsf: number | null;
  median_lease_rent: number | null;
  median_cap: number | null;
  price_per_sf: number | null;
  vintage_band: string | null;
}

export function MarketingCopyPanel({
  propertyId,
  initialHeadline,
  initialDescription,
  initialHighlights,
}: {
  propertyId: string;
  initialHeadline: string | null;
  initialDescription: string | null;
  initialHighlights: string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");

  // Saved values — re-rendered fresh from DB after each successful save.
  const [savedHeadline, setSavedHeadline] = useState(initialHeadline ?? "");
  const [savedDescription, setSavedDescription] = useState(initialDescription ?? "");
  const [savedHighlights, setSavedHighlights] = useState<string[]>(initialHighlights ?? []);

  // Edit buffer — only used in EDIT mode.
  const [editHeadline, setEditHeadline] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editHighlights, setEditHighlights] = useState("");

  // Preview buffer — only used in PREVIEW mode.
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [contextSummary, setContextSummary] = useState<ContextSummary | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isEmpty =
    !savedHeadline && !savedDescription && (savedHighlights?.length ?? 0) === 0;

  function beginEdit() {
    setEditHeadline(savedHeadline);
    setEditDescription(savedDescription);
    setEditHighlights((savedHighlights ?? []).join("\n"));
    setMode("edit");
    setError(null);
  }

  function cancelEdit() {
    setMode("view");
    setError(null);
  }

  async function saveEdit() {
    setBusy(true);
    setError(null);
    try {
      const highlights = editHighlights
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: editHeadline.trim() || null,
          description: editDescription.trim() || null,
          highlights,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setSavedHeadline(editHeadline.trim());
      setSavedDescription(editDescription.trim());
      setSavedHighlights(highlights);
      setMode("view");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function generate(isRegenerate: boolean = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}/marketing/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: "description", dryRun: true }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json();
      setPreview(data.generated);
      setContextSummary(data.context_summary ?? null);
      setMode("preview");
      if (!isRegenerate) setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePreview() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: preview.headline || null,
          description: preview.description || null,
          highlights: preview.highlights ?? [],
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setSavedHeadline(preview.headline);
      setSavedDescription(preview.description);
      setSavedHighlights(preview.highlights);
      setPreview(null);
      setContextSummary(null);
      setMode("view");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function cancelPreview() {
    setPreview(null);
    setContextSummary(null);
    setMode("view");
    setError(null);
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  if (mode === "edit") {
    return (
      <div className="space-y-3">
        <FieldLabel>Headline</FieldLabel>
        <input
          type="text"
          value={editHeadline}
          onChange={(e) => setEditHeadline(e.target.value)}
          maxLength={140}
          placeholder='e.g. "37,000 SF Flex Building — $108/SF — Merrillville, IN"'
          className={inputCls}
        />
        <FieldLabel>Description (markdown OK, paragraph breaks honored)</FieldLabel>
        <textarea
          value={editDescription}
          onChange={(e) => setEditDescription(e.target.value)}
          rows={8}
          placeholder="Marketing copy — 200-400 words is typical for CREXi / LoopNet."
          className={`${inputCls} font-body resize-y`}
        />
        <FieldLabel>Highlights — one per line</FieldLabel>
        <textarea
          value={editHighlights}
          onChange={(e) => setEditHighlights(e.target.value)}
          rows={6}
          placeholder={"4-6 short bullets, lead with concrete fact each line.\nExample:\n37,000 SF flex, 100% vacant at close\n$4M ask — $108/SF"}
          className={`${inputCls} font-mono text-[11.5px] resize-y`}
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={cancelEdit} className={btnNeutral}>Cancel</button>
          <button onClick={saveEdit} disabled={busy} className={btnPrimary}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "preview" && preview) {
    return (
      <div className="space-y-4">
        <div className="rounded border border-teal-400/30 bg-teal-400/[0.04] px-3 py-2 font-mono text-[10.5px] text-teal-300">
          Preview — not saved yet. Read it, then Save or Regenerate.
        </div>

        <RenderCopy headline={preview.headline} description={preview.description} highlights={preview.highlights} />

        {preview.observations && preview.observations.length > 0 && (
          <div className="rounded border border-amber-400/30 bg-amber-400/[0.04] p-3">
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-amber-300 mb-2">
              Steward-style observations · {preview.observations.length}
            </div>
            <ul className="space-y-1.5 font-body text-[12px] text-cream-dim leading-relaxed list-disc list-inside marker:text-amber-400">
              {preview.observations.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}

        {contextSummary && (
          <div className="font-mono text-[10px] text-cream-subtle border-t border-white/[0.04] pt-2 leading-relaxed">
            <div>
              context: {contextSummary.sale_comps_used} sale comps · {contextSummary.lease_comps_used} lease comps ·{" "}
              {contextSummary.median_sale_ppsf ? `median sale $/SF ${Math.round(contextSummary.median_sale_ppsf)}` : "no sale median"}
              {" · "}
              {contextSummary.price_per_sf ? `subject $/SF ${Math.round(contextSummary.price_per_sf)}` : ""}
              {contextSummary.vintage_band ? ` · vintage band ${contextSummary.vintage_band}` : ""}
            </div>
          </div>
        )}

        {error && <ErrorBox>{error}</ErrorBox>}

        <div className="flex items-center gap-2 pt-1">
          <button onClick={cancelPreview} className={btnNeutral}>Discard</button>
          <button onClick={() => generate(true)} disabled={busy} className={btnSecondary}>
            {busy ? "Regenerating…" : "Regenerate"}
          </button>
          <button onClick={savePreview} disabled={busy} className={btnPrimary}>
            {busy ? "Saving…" : "Save this version"}
          </button>
        </div>
      </div>
    );
  }

  // VIEW mode
  return (
    <div className="space-y-4">
      {isEmpty ? (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center">
          <p className="font-body text-[13px] text-cream-dim">
            No marketing copy generated yet.
          </p>
          <p className="font-body text-[11.5px] text-cream-subtle mt-1">
            The generator pulls property facts, nearby comps, and your voice profile to draft a headline,
            description, and highlights.
          </p>
        </div>
      ) : (
        <RenderCopy headline={savedHeadline} description={savedDescription} highlights={savedHighlights} />
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
        <button onClick={() => generate(false)} disabled={busy} className={btnPrimary}>
          {busy ? "Generating…" : isEmpty ? "Generate with AI" : "Regenerate with AI"}
        </button>
        {!isEmpty && (
          <button onClick={beginEdit} className={btnNeutral}>Edit</button>
        )}
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

function RenderCopy({
  headline,
  description,
  highlights,
}: {
  headline: string;
  description: string;
  highlights: string[];
}) {
  return (
    <div className="space-y-4">
      {headline && (
        <div>
          <Eyebrow tone="muted">Headline</Eyebrow>
          <h3 className="mt-1 font-display text-[16px] text-cream tracking-tight">{headline}</h3>
        </div>
      )}
      {description && (
        <div>
          <Eyebrow tone="muted">Description</Eyebrow>
          <p className="mt-1 font-body text-[13px] text-cream-dim leading-relaxed whitespace-pre-wrap">
            {description}
          </p>
        </div>
      )}
      {highlights.length > 0 && (
        <div>
          <Eyebrow tone="muted">Highlights · {highlights.length}</Eyebrow>
          <ul className="mt-1.5 space-y-1 font-body text-[12.5px] text-cream-dim list-disc list-inside marker:text-coral-400 leading-relaxed">
            {highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
      {children}
    </label>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11.5px] text-red-300">
      {children}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.08] focus:border-teal-400/40 focus:outline-none font-body text-[13px] text-cream placeholder:text-cream-subtle";

const btnPrimary =
  "px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed";
const btnSecondary =
  "px-4 py-2 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-teal-300 disabled:opacity-40 disabled:cursor-not-allowed";
const btnNeutral =
  "px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream";
