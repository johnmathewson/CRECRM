"use client";

import { useState, useMemo, useEffect } from "react";
import type { PortalAudience, PortalCandidate, PortalContactCandidate } from "@/lib/cre-os/portal-queries";

/**
 * CreatePortalDialog — modal form for spinning up a new magic link.
 * Steps: pick audience → pick property/properties → pick recipient (optional) →
 * label + expiry → result with copyable URL.
 */
export function CreatePortalDialog({
  properties,
  contacts,
  presetPropertyIds,
  presetAudience,
  onClose,
  onCreated,
}: {
  properties: PortalCandidate[];
  contacts: PortalContactCandidate[];
  presetPropertyIds: string[];
  presetAudience: PortalAudience;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [audience, setAudience] = useState<PortalAudience>(presetAudience);
  const [selectedIds, setSelectedIds] = useState<string[]>(presetPropertyIds);
  const [contactId, setContactId] = useState<string>("");
  const [label, setLabel] = useState<string>("");
  const [expiryDays, setExpiryDays] = useState<number>(90);
  const [propertyQuery, setPropertyQuery] = useState<string>("");
  const [contactQuery, setContactQuery] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; label: string } | null>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredProperties = useMemo(() => {
    const q = propertyQuery.trim().toLowerCase();
    if (!q) return properties;
    return properties.filter((p) =>
      [p.name, p.headline, p.city, p.state].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [properties, propertyQuery]);

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) =>
      [c.name, c.email].some((v) => v && v.toLowerCase().includes(q))
    );
  }, [contacts, contactQuery]);

  function toggleProperty(id: string) {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function submit() {
    setError(null);
    if (selectedIds.length === 0) {
      setError("Pick at least one property.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/owner-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_ids: selectedIds,
          owner_contact_id: contactId || null,
          label: label.trim() || undefined,
          expires_in_days: expiryDays,
          audience,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create");
      setResult({ url: json.url, label: json.token?.label || "Magic link ready" });
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  function copyResult() {
    if (!result) return;
    navigator.clipboard.writeText(result.url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-2xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">Generate magic link</div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream">
              {result ? "Link ready" : "Create owner / investor portal"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-cream-subtle hover:text-cream font-mono text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {result ? (
            <>
              <p className="font-body text-[13px] text-cream-dim">
                Share this URL with the recipient. It expires in {expiryDays} days, can be revoked any time, and renders the
                listing performance dashboard on stewardshipcre.com.
              </p>
              <div className="rounded border border-coral-400/30 bg-coral-400/[0.05] px-4 py-3">
                <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-300 mb-1">{result.label}</div>
                <div className="font-mono text-[12px] text-cream break-all">{result.url}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={copyResult}
                  className="px-3.5 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300"
                >
                  Copy URL
                </button>
                <button
                  onClick={onCreated}
                  className="px-3.5 py-2 rounded border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.08] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Audience */}
              <Field label="Audience" hint="Owner = seller view of listing performance. Investor = buyer/LP view of pursuit progress.">
                <div className="flex gap-2">
                  <RadioChip
                    active={audience === "owner"}
                    onClick={() => setAudience("owner")}
                    label="Owner"
                    sub="seller magic link"
                  />
                  <RadioChip
                    active={audience === "investor"}
                    onClick={() => setAudience("investor")}
                    label="Investor"
                    sub="buyer / LP magic link"
                  />
                </div>
              </Field>

              {/* Properties */}
              <Field label={`Properties (${selectedIds.length} selected)`} hint="Pick one for a single-listing dashboard, or several for a portfolio view.">
                <input
                  type="text"
                  value={propertyQuery}
                  onChange={(e) => setPropertyQuery(e.target.value)}
                  placeholder="Filter by name, address, city…"
                  className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
                />
                <div className="mt-2 max-h-48 overflow-y-auto rounded border border-white/[0.04] bg-steward-surface/30">
                  {filteredProperties.length === 0 ? (
                    <div className="px-3 py-3 font-body text-[11px] text-cream-subtle">No properties match.</div>
                  ) : (
                    filteredProperties.map((p) => {
                      const sel = selectedIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggleProperty(p.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b border-white/[0.03] last:border-b-0 transition-colors ${
                            sel ? "bg-coral-400/[0.08]" : "hover:bg-white/[0.03]"
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center text-coral-300 ${
                            sel ? "border-coral-400 bg-coral-400/20" : "border-white/[0.15]"
                          }`}>
                            {sel ? <span className="text-[8px] font-mono">✓</span> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-body text-[12px] text-cream truncate">{p.name}</span>
                            <span className="block font-body text-[10px] text-cream-subtle truncate">
                              {[p.headline, [p.city, p.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </Field>

              {/* Recipient (optional) */}
              <Field label="Recipient contact (optional)" hint="For your own records — the contact tied to this link. They are not auto-emailed.">
                <input
                  type="text"
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  placeholder="Search contacts…"
                  className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
                />
                {contactQuery.trim() && (
                  <div className="mt-2 max-h-32 overflow-y-auto rounded border border-white/[0.04] bg-steward-surface/30">
                    {filteredContacts.length === 0 ? (
                      <div className="px-3 py-2 font-body text-[11px] text-cream-subtle">No contacts match.</div>
                    ) : (
                      filteredContacts.slice(0, 30).map((c) => {
                        const sel = c.id === contactId;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setContactId(sel ? "" : c.id);
                              setContactQuery(sel ? "" : c.name);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-1.5 text-left border-b border-white/[0.03] last:border-b-0 transition-colors ${
                              sel ? "bg-coral-400/[0.08]" : "hover:bg-white/[0.03]"
                            }`}
                          >
                            <span className="font-body text-[12px] text-cream truncate">{c.name}</span>
                            <span className="font-body text-[10px] text-cream-subtle ml-2 truncate">{c.email || ""}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
                {contactId && (
                  <div className="mt-1 font-body text-[10px] text-coral-300">
                    Selected: {contacts.find((c) => c.id === contactId)?.name}{" "}
                    <button onClick={() => { setContactId(""); setContactQuery(""); }} className="underline ml-1">clear</button>
                  </div>
                )}
              </Field>

              {/* Label + expiry */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Label" hint="Auto-fills if blank.">
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Owner — 850 Lakeshore"
                    className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
                  />
                </Field>
                <Field label="Expires in">
                  <select
                    value={expiryDays}
                    onChange={(e) => setExpiryDays(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream"
                  >
                    <option value={30}>30 days</option>
                    <option value={60}>60 days</option>
                    <option value={90}>90 days (default)</option>
                    <option value={180}>180 days</option>
                    <option value={365}>365 days</option>
                  </select>
                </Field>
              </div>

              {error && (
                <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
                <button
                  onClick={onClose}
                  className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={busy || selectedIds.length === 0}
                  className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? "Generating…" : "Generate link"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</label>
      {hint && <div className="mt-0.5 font-body text-[10px] text-cream-subtle">{hint}</div>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function RadioChip({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2.5 rounded border text-left transition-colors ${
        active
          ? "border-coral-400/40 bg-coral-400/[0.10] ring-1 ring-inset ring-coral-400/20"
          : "border-white/[0.06] bg-steward-surface/40 hover:bg-white/[0.04]"
      }`}
    >
      <div className={`font-heading text-[12px] font-semibold ${active ? "text-coral-200" : "text-cream"}`}>{label}</div>
      <div className="mt-0.5 font-body text-[10px] text-cream-subtle">{sub}</div>
    </button>
  );
}
