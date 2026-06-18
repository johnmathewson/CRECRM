"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PROPERTY_STATUS_ORDER, PROPERTY_STATUS_META } from "@/lib/cre-os/property-status";
import type { PropertyMatch } from "@/app/api/properties/match/route";

/**
 * CreatePropertyDialog — adds a new property AND auto-pairs a deal so it
 * shows up in the pipeline immediately. The Phase 8 unlock for "I want to
 * track a new opportunity from scratch."
 *
 * Default status is "listed" because that's the most common entry point;
 * the picker exposes the full ladder for use cases like "just sourced this,
 * starting BOV" (status="pitched") or "inbound seller inquiry, very early"
 * (status="prospecting").
 */
export function CreatePropertyDialog({
  open,
  onClose,
  defaultTransactionType = "sale",
}: {
  open: boolean;
  onClose: () => void;
  defaultTransactionType?: "sale" | "lease";
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("IN");
  const [zip, setZip] = useState("");
  const [assetType, setAssetType] = useState<string>("retail");
  const [transactionType, setTransactionType] = useState<"sale" | "lease">(defaultTransactionType);
  const [askingPrice, setAskingPrice] = useState("");
  const [leaseRate, setLeaseRate] = useState("");
  const [sqft, setSqft] = useState("");
  const [status, setStatus] = useState<string>("listed");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Fuzzy-match against the 15k properties already in the DB. As the
  // broker types an address or name, surface candidate matches. Pick one
  // → navigate to the existing property page (skip the create flow). If
  // no match feels right, the broker dismisses and continues creating.
  const [matches, setMatches] = useState<PropertyMatch[]>([]);
  const [matchSearching, setMatchSearching] = useState(false);
  const [matchDismissedFor, setMatchDismissedFor] = useState<string>("");
  const lastQueryRef = useRef<string>("");

  // Reset on close
  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      setMatches([]);
      setMatchDismissedFor("");
    }
  }, [open]);

  // Debounced match search. Triggers on either address OR name typing.
  // The longer of the two is used as the query — usually that's what
  // the broker is actively working on. Dismissal is sticky per query
  // text so the panel doesn't pop back up immediately after dismiss.
  useEffect(() => {
    if (!open) return;
    const query = (address.length >= name.length ? address : name).trim();
    if (query.length < 3) {
      setMatches([]);
      lastQueryRef.current = "";
      return;
    }
    if (query === matchDismissedFor) {
      setMatches([]);
      return;
    }
    lastQueryRef.current = query;
    setMatchSearching(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/properties/match?q=${encodeURIComponent(query)}&limit=5`);
        if (lastQueryRef.current !== query) return; // stale response
        if (!r.ok) {
          setMatches([]);
          return;
        }
        const json = await r.json();
        setMatches((json.matches ?? []) as PropertyMatch[]);
      } catch {
        setMatches([]);
      } finally {
        if (lastQueryRef.current === query) setMatchSearching(false);
      }
    }, 280);
    return () => {
      clearTimeout(timer);
    };
  }, [open, address, name, matchDismissedFor]);

  function pickMatch(m: PropertyMatch) {
    onClose();
    router.push(`/cre-os/properties/${m.slug ?? m.id}`);
  }

  function dismissMatches() {
    setMatchDismissedFor((address.length >= name.length ? address : name).trim());
    setMatches([]);
  }

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!name.trim() && !address.trim()) {
      setError("Provide at least a property name or address.");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        // Use address+city as a friendly default name when the broker leaves it blank
        name: name.trim() || `${address}${city ? ", " + city : ""}`,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        zip: zip.trim() || undefined,
        asset_type: assetType,
        transaction_type: transactionType,
        status,
        notes: notes.trim() || undefined,
        create_deal: true,
      };
      if (askingPrice && transactionType === "sale") {
        const n = Number(askingPrice.replace(/[$,]/g, ""));
        if (!Number.isNaN(n)) payload.asking_price = n;
      }
      if (leaseRate && transactionType === "lease") {
        const n = Number(leaseRate.replace(/[$,]/g, ""));
        if (!Number.isNaN(n)) payload.lease_rate = n;
      }
      if (sqft) {
        const n = Number(sqft.replace(/,/g, ""));
        if (!Number.isNaN(n)) payload.sqft = n;
      }

      const res = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      // Navigate to the new property workspace — broker can keep filling out details there
      const slug = json.property?.slug || json.property?.id;
      if (slug) {
        router.push(`/cre-os/properties/${slug}`);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-2xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft flex flex-col max-h-[calc(100vh-1rem)] lg:max-h-[calc(100vh-6rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">
              New property
            </div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream">
              Add a property to the pipeline
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

        <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
          {/* Address-first — that's how a broker thinks about a property */}
          <Field label="Address" hint="Most direct way to identify the property.">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="3005 John Howell Drive"
              autoFocus
              className={fieldCls}
            />
          </Field>

          {/* ── Fuzzy match against the 15k properties in the DB ───────
              Surfaces existing records as the broker types. Click one
              to open the existing property workspace; skip to keep
              creating new. */}
          {(matchSearching || matches.length > 0) && (
            <div className="rounded border border-teal-400/30 bg-teal-400/[0.05] p-3 -mt-2">
              <div className="flex items-center justify-between mb-2">
                <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-teal-300">
                  {matchSearching
                    ? "Searching your book…"
                    : `${matches.length} possible match${matches.length === 1 ? "" : "es"} already in your book`}
                </div>
                {matches.length > 0 && (
                  <button
                    type="button"
                    onClick={dismissMatches}
                    className="font-mono text-[10px] text-cream-subtle hover:text-cream underline-offset-2 hover:underline"
                  >
                    none of these — keep creating new
                  </button>
                )}
              </div>
              {matches.length > 0 && (
                <div className="space-y-1.5">
                  {matches.map((m) => {
                    const subline = [m.address, m.city, m.state].filter(Boolean).join(" · ");
                    const confidence = Math.round(m.match_score * 100);
                    const tone =
                      confidence >= 70
                        ? "text-teal-300"
                        : confidence >= 40
                          ? "text-amber-300"
                          : "text-cream-subtle";
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => pickMatch(m)}
                        className="w-full text-left p-2 rounded border border-white/[0.06] bg-white/[0.02] hover:bg-teal-400/[0.10] hover:border-teal-400/40 transition-colors"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-heading text-[12.5px] text-cream truncate">
                              {m.name || m.address || "(unnamed property)"}
                            </div>
                            <div className="font-mono text-[10.5px] text-cream-subtle truncate mt-0.5">
                              {subline}
                              {m.asset_type ? ` · ${m.asset_type}` : ""}
                              {m.sqft ? ` · ${m.sqft.toLocaleString()} sf` : ""}
                            </div>
                          </div>
                          <div className={`font-mono text-[10px] whitespace-nowrap shrink-0 ${tone}`}>
                            {confidence}% match
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Valparaiso" className={fieldCls} />
            </Field>
            <Field label="State">
              <input value={state} onChange={(e) => setState(e.target.value)} maxLength={2} className={fieldCls} />
            </Field>
            <Field label="Zip">
              <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="46383" className={fieldCls} />
            </Field>
          </div>

          <Field label="Display name (optional)" hint="Defaults to the address if blank. A nickname helps when one address has multiple deals.">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Super 8 Valparaiso"
              className={fieldCls}
            />
          </Field>

          {/* Transaction type radio (drives which price field shows) */}
          <Field label="Transaction" hint="What you're working on. Drives the pricing field below.">
            <div className="flex gap-2">
              <RadioChip
                active={transactionType === "sale"}
                onClick={() => setTransactionType("sale")}
                label="Sale"
                sub="working a disposition"
              />
              <RadioChip
                active={transactionType === "lease"}
                onClick={() => setTransactionType("lease")}
                label="Lease"
                sub="working a lease"
              />
            </div>
          </Field>

          {/* Asset type + sqft + price */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Asset type">
              <select value={assetType} onChange={(e) => setAssetType(e.target.value)} className={fieldCls}>
                <option value="retail">Retail</option>
                <option value="office">Office</option>
                <option value="industrial">Industrial</option>
                <option value="hospitality">Hospitality</option>
                <option value="multifamily">Multifamily</option>
                <option value="medical">Medical</option>
                <option value="mixed_use">Mixed use</option>
                <option value="land">Land</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Square feet">
              <input
                type="text"
                inputMode="numeric"
                value={sqft}
                onChange={(e) => setSqft(e.target.value)}
                placeholder="12,500"
                className={fieldCls}
              />
            </Field>
          </div>

          {transactionType === "sale" ? (
            <Field label="Asking price">
              <input
                type="text"
                inputMode="decimal"
                value={askingPrice}
                onChange={(e) => setAskingPrice(e.target.value)}
                placeholder="$2,400,000"
                className={fieldCls}
              />
            </Field>
          ) : (
            <Field label="Lease rate ($/SF/yr)">
              <input
                type="text"
                inputMode="decimal"
                value={leaseRate}
                onChange={(e) => setLeaseRate(e.target.value)}
                placeholder="$24.50"
                className={fieldCls}
              />
            </Field>
          )}

          {/* Status — this controls which pipeline column the auto-paired deal lands in */}
          <Field label="Status" hint="Determines where this property starts in the pipeline.">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={fieldCls}
            >
              {PROPERTY_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {PROPERTY_STATUS_META[s].label} — {PROPERTY_STATUS_META[s].hint}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Anything you want captured up front — broker contact, story, next step…"
              className={`${fieldCls} resize-y`}
            />
          </Field>

          {error && (
            <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Pinned action bar — always visible regardless of body scroll
            depth, so the broker never loses sight of Save when the match
            panel or future fields push the body taller than the viewport. */}
        <div className="px-6 py-3 border-t border-white/[0.06] flex items-center justify-end gap-2 shrink-0 bg-steward-base rounded-b">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? "Adding…" : "Add property"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
const fieldCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

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
