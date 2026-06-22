"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { PROPERTY_STATUS_ORDER, PROPERTY_STATUS_META } from "@/lib/cre-os/property-status";
import type { PropertyMatch } from "@/app/api/properties/match/route";

// Leaflet needs `window` on first mount — ssr:false so it skips at build.
const PropertyLocationPicker = dynamic(
  () => import("@/components/cre-os/property/PropertyLocationPicker").then((m) => m.PropertyLocationPicker),
  { ssr: false, loading: () => (
    <div className="h-64 rounded border border-white/[0.08] bg-steward-surface/40 flex items-center justify-center">
      <span className="font-mono text-[10.5px] text-cream-subtle">Loading map…</span>
    </div>
  )}
);

// localStorage key for the in-progress create-property draft. Versioned
// so a future shape change doesn't try to hydrate stale fields.
const DRAFT_KEY = "crecrm:create_property_draft:v1";

interface DraftShape {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  assetType: string;
  transactionType: "sale" | "lease";
  askingPrice: string;
  leaseRate: string;
  sqft: string;
  status: string;
  notes: string;
  savedAt: string;
}

function clearDraft() {
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
}

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
  // Spatial anchor — for vacant land / unaddressed parcels. Pin-drop
  // map below the city/state/zip row writes these.
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [apn, setApn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Draft autosave to localStorage ────────────────────────────────────
  // Persist every field on change so the broker can close the dialog mid-
  // fill (or refresh the page) without losing work. Hydrated on open;
  // cleared after a successful create. "Discard draft" button restores
  // a blank form.
  const [draftRestored, setDraftRestored] = useState(false);
  const hydratedRef = useRef(false);

  // ── Fuzzy-match against the 15k properties already in the DB. As the
  // broker types an address or name, surface candidate matches. Pick one
  // → navigate to the existing property page (skip the create flow). If
  // no match feels right, the broker dismisses and continues creating.
  const [matches, setMatches] = useState<PropertyMatch[]>([]);
  const [matchSearching, setMatchSearching] = useState(false);
  const [matchDismissedFor, setMatchDismissedFor] = useState<string>("");
  const lastQueryRef = useRef<string>("");

  // Hydrate from localStorage draft on open. Runs ONCE per open cycle —
  // hydratedRef prevents the autosave effect from clobbering the draft
  // before we've read it on first render.
  useEffect(() => {
    if (!open || hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<DraftShape>;
      let any = false;
      if (draft.name) { setName(draft.name); any = true; }
      if (draft.address) { setAddress(draft.address); any = true; }
      if (draft.city) { setCity(draft.city); any = true; }
      if (draft.state) { setState(draft.state); any = true; }
      if (draft.zip) { setZip(draft.zip); any = true; }
      if (draft.assetType) { setAssetType(draft.assetType); any = true; }
      if (draft.transactionType) { setTransactionType(draft.transactionType); any = true; }
      if (draft.askingPrice) { setAskingPrice(draft.askingPrice); any = true; }
      if (draft.leaseRate) { setLeaseRate(draft.leaseRate); any = true; }
      if (draft.sqft) { setSqft(draft.sqft); any = true; }
      if (draft.status) { setStatus(draft.status); any = true; }
      if (draft.notes) { setNotes(draft.notes); any = true; }
      if (any) setDraftRestored(true);
    } catch {
      // Corrupt draft — drop it silently rather than blocking the dialog
      try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    }
  }, [open]);

  // Persist current form state to localStorage on every change. Skips
  // the first render after hydration so we don't overwrite the draft
  // with the default values before the broker has typed anything.
  useEffect(() => {
    if (!open || !hydratedRef.current) return;
    try {
      const draft: DraftShape = {
        name, address, city, state, zip, assetType, transactionType,
        askingPrice, leaseRate, sqft, status, notes,
        savedAt: new Date().toISOString(),
      };
      // Don't write a draft that's effectively empty (saves the user
      // from seeing a "draft restored" banner just because they opened
      // and closed the dialog without typing).
      const hasContent = !!(
        name.trim() || address.trim() || city.trim() ||
        askingPrice || leaseRate || sqft || notes.trim()
      );
      if (hasContent) {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } else {
        window.localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* localStorage may be unavailable in private windows — ignore */
    }
  }, [
    open, name, address, city, state, zip, assetType, transactionType,
    askingPrice, leaseRate, sqft, status, notes,
  ]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
      setMatches([]);
      setMatchDismissedFor("");
      // Reset hydration guard so next open re-reads the draft (in
      // case the broker closed without saving and is coming back).
      hydratedRef.current = false;
      setDraftRestored(false);
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
    // Need at least one of: name, address, or a map pin. The map pin
    // alone is enough — vacant land / unaddressed parcels work that way.
    if (!name.trim() && !address.trim() && (latitude === null || longitude === null)) {
      setError("Provide a property name, an address, or drop a pin on the map.");
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        // Use address+city as a friendly default name when the broker leaves it blank
        name: name.trim() || `${address}${city ? ", " + city : ""}` || "Untitled property",
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        zip: zip.trim() || undefined,
        asset_type: assetType,
        transaction_type: transactionType,
        status,
        notes: notes.trim() || undefined,
        create_deal: true,
        // Spatial anchor — pinned via the map. Saved as null if not set.
        latitude: latitude,
        longitude: longitude,
        apn: apn,
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
      // Successful create — drop the draft so the next "Add Property"
      // opens to a clean form.
      clearDraft();
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
          {/* Restored-draft banner. Shows once when we hydrate fields
              from a prior in-progress draft so the broker knows where
              the data came from. "Discard" clears the form back to a
              clean slate. */}
          {draftRestored && (
            <div className="rounded border border-teal-400/30 bg-teal-400/[0.06] px-3 py-2 flex items-center justify-between gap-3">
              <div className="font-body text-[12px] text-teal-300">
                Draft restored. Your fields auto-save as you type — close any time without losing work.
              </div>
              <button
                onClick={() => {
                  clearDraft();
                  setName(""); setAddress(""); setCity(""); setState("IN"); setZip("");
                  setAssetType("retail"); setTransactionType(defaultTransactionType);
                  setAskingPrice(""); setLeaseRate(""); setSqft("");
                  setStatus("listed"); setNotes("");
                  setDraftRestored(false);
                }}
                className="font-mono text-[10.5px] text-cream-subtle hover:text-cream underline underline-offset-2"
              >
                Discard draft
              </button>
            </div>
          )}

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

          {/* Map pin · spatial anchor. Required for any property
              without a clean street address (vacant land, multi-
              parcel campuses). The valuation tool reads lat/lng
              before address. */}
          <div>
            <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-2">
              Map pin · spatial anchor
              <span className="ml-2 normal-case text-cream-subtle italic font-body text-[10px]">
                — leave address blank and drop a pin for unaddressed parcels
              </span>
            </div>
            <PropertyLocationPicker
              initialLatitude={latitude}
              initialLongitude={longitude}
              initialApn={apn}
              fallbackAddress={[address, city, state, zip].filter(Boolean).join(", ")}
              onChange={(next) => {
                setLatitude(next.latitude);
                setLongitude(next.longitude);
                setApn(next.apn);
              }}
            />
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
