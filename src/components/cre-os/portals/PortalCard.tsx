"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { PortalToken } from "@/lib/cre-os/portal-queries";

/**
 * PortalCard — single magic-link row. Shows audience, label, properties,
 * recipient, status, last-viewed signal. Quick actions: copy URL, open in
 * a new tab, revoke.
 */
export function PortalCard({ token, onChanged }: { token: PortalToken; onChanged: () => void }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(token.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function revoke() {
    if (token.status !== "active") return;
    if (!confirm(`Revoke "${token.label}"? The recipient will see "Link expired" on next visit.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/owner-tokens/${token.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      onChanged();
    } catch (err: any) {
      alert(`Revoke failed: ${err.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  const audienceTone = token.audience === "investor" ? "teal" : "coral";
  const statusTone =
    token.status === "active" ? "teal" :
    token.status === "expired" ? "amber" :
    "neutral";
  const lastViewedLabel =
    token.lastViewedAt === null
      ? "Never opened"
      : token.daysSinceLastView === 0
        ? "Opened today"
        : `Opened ${token.daysSinceLastView}d ago`;
  const expiryLabel =
    token.status === "expired"
      ? "Expired"
      : token.status === "revoked"
        ? "Revoked"
        : token.daysUntilExpiry !== null && token.daysUntilExpiry <= 14
          ? `Expires in ${token.daysUntilExpiry}d`
          : `Expires ${formatShortDate(token.expiresAt)}`;

  return (
    <article className={`rounded border bg-steward-surface/40 px-4 lg:px-5 py-4 transition-colors ${
      token.status === "active"
        ? "border-white/[0.06] hover:border-white/[0.12]"
        : "border-white/[0.04] opacity-70"
    }`}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 lg:gap-6">
        {/* Left: identity */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge tone={audienceTone} size="xs">{token.audience}</StatusBadge>
            <StatusBadge tone={statusTone} size="xs">{token.status}</StatusBadge>
            <h3 className="font-heading font-semibold text-[14px] text-cream truncate">{token.label}</h3>
          </div>

          {/* Properties */}
          <div className="mt-2 font-body text-[12px] text-cream-dim">
            {token.properties.length === 0 ? (
              <span className="text-cream-subtle italic">No properties (deleted?)</span>
            ) : token.properties.length === 1 ? (
              <>
                <span className="text-cream">{token.properties[0].headline || token.properties[0].name}</span>
                {(token.properties[0].city || token.properties[0].state) && (
                  <span className="text-cream-subtle"> · {[token.properties[0].city, token.properties[0].state].filter(Boolean).join(", ")}</span>
                )}
              </>
            ) : (
              <>
                <span className="text-cream">{token.properties.length} listings</span>
                <span className="text-cream-subtle"> · {token.properties.slice(0, 3).map(p => p.name).join(", ")}{token.properties.length > 3 ? ` +${token.properties.length - 3}` : ""}</span>
              </>
            )}
          </div>

          {/* Recipient */}
          {token.ownerContact && (
            <div className="mt-1 font-body text-[11px] text-cream-subtle">
              For <span className="text-cream-dim">{token.ownerContact.name || token.ownerContact.email || "—"}</span>
              {token.ownerContact.email && token.ownerContact.name && (
                <span className="text-cream-subtle"> · {token.ownerContact.email}</span>
              )}
            </div>
          )}
        </div>

        {/* Right: signals + actions */}
        <div className="shrink-0 flex flex-row lg:flex-col items-center lg:items-end justify-between lg:justify-start gap-2 lg:text-right flex-wrap">
          <div className="flex flex-col items-start lg:items-end gap-0.5">
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{lastViewedLabel}</div>
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{expiryLabel}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={copyLink}
              className="px-2.5 py-1 rounded border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={token.shareUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 rounded border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
            >
              Open ↗
            </a>
            {token.status === "active" && (
              <button
                onClick={revoke}
                disabled={busy}
                className="px-2.5 py-1 rounded border border-red-400/25 bg-red-500/[0.08] hover:bg-red-500/[0.14] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-red-300 transition-colors disabled:opacity-50"
              >
                {busy ? "…" : "Revoke"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Token URL (truncated, monospaced) */}
      <div className="mt-3 pt-3 border-t border-white/[0.04] font-mono text-[10px] text-cream-subtle truncate">
        {token.shareUrl}
      </div>
    </article>
  );
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
