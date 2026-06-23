"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * SiblingLink — the dual-purpose UI for the sale↔lease sibling listing
 * relationship. Renders one of two states:
 *
 *   STATE A — sibling exists: a teal "🔗 Linked listing" pill that
 *     navigates to the sibling's workspace.
 *
 *   STATE B — no sibling yet: a "Spawn sibling listing" button that
 *     calls POST /api/properties/[id]/spawn-sibling, creates the
 *     sibling record (cloned building facts, opposite transaction_type,
 *     fresh marketing slate, fresh lifecycle), and navigates to it.
 *
 * The spawn API enforces 1:1 (a property can have at most one sibling)
 * and refuses to spawn from a property with no transaction_type set.
 */
export function SiblingLink({
  propertyId,
  transactionType,
  related,
}: {
  propertyId: string;
  transactionType: string | null;
  related: {
    id: string;
    slug: string;
    name: string;
    transactionType: string | null;
    status: string | null;
  } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // STATE A — sibling already exists. Render the link pill.
  if (related) {
    const siblingMode = related.transactionType === "sale" ? "For Sale" : "For Lease";
    return (
      <Link
        href={`/cre-os/properties/${related.slug}`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-teal-400/40 bg-teal-400/[0.08] hover:bg-teal-400/[0.16] font-mono text-[10px] text-teal-300 uppercase tracking-eyebrow whitespace-nowrap transition-colors"
        title={`Sibling listing: ${related.name}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Linked · {siblingMode}
      </Link>
    );
  }

  // STATE B — no sibling. Render the spawn button.
  // Disabled when transactionType is missing (can't decide the
  // sibling's mode without knowing the source's).
  const canSpawn = transactionType === "sale" || transactionType === "lease";
  const targetMode = transactionType === "sale" ? "for-lease" : transactionType === "lease" ? "for-sale" : null;

  async function spawn() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}/spawn-sibling`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) {
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      // Navigate to the new sibling's workspace so John can fill in
      // its rate / available SF / lease type / fresh marketing copy.
      const slug = j?.sibling?.slug;
      if (slug) {
        startTransition(() => router.push(`/cre-os/properties/${slug}`));
      } else {
        startTransition(() => router.refresh());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!canSpawn) return null;

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={spawn}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-coral-400/[0.10] hover:border-coral-400/40 hover:text-coral-300 font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title={`Clone this listing into a ${targetMode} version — building facts and photos copy over, you just add the rate / available SF / lease type`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <rect x="9" y="9" width="11" height="11" rx="1.5" strokeLinejoin="round" />
          <path d="M5 15V5a1 1 0 0 1 1-1h10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {busy ? "Cloning…" : `Clone as ${targetMode}`}
      </button>
      {error ? (
        <span className="font-mono text-[10px] text-coral-300">{error}</span>
      ) : null}
    </div>
  );
}
