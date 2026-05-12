"use client";

/**
 * EditPropertyDialog — modal for editing every mutable field on an
 * existing property record. Pre-populated from the workspace data; PATCHes
 * /api/properties/[id] on save and refreshes the page.
 *
 * Mirrors CreatePropertyDialog's section structure (Address → Asset →
 * Pricing/Size → Financials → Building → Marketing) so the broker's
 * mental model carries between create and edit.
 *
 * Status is intentionally NOT in this dialog — the StatusEditor pill on
 * the masthead handles status (with deal-stage propagation logic). Same
 * for crexi/loopnet URLs which have inline editors on the Listings page.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

interface Props {
  open: boolean;
  property: PropertyDetail;
  onClose: () => void;
}

/** Shape of the row we pull via GET /api/properties/[id]. Has every column
 *  the PATCH whitelist accepts; PropertyDetail (the workspace-scoped type)
 *  doesn't carry every one of them, so we hydrate the dialog from a fresh
 *  fetch rather than depending on the prop. */
interface FullPropertyRow {
  name: string | null;
  headline: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: string | null;
  transaction_type: string | null;
  your_role: string | null;
  asking_price: number | null;
  lease_rate: number | null;
  sqft: number | null;
  acreage: number | null;
  year_built: number | null;
  noi: number | null;
  cap_rate: number | null;
  price_per_sf: number | null;
  occupancy_pct: number | null;
  parking_spaces: number | null;
  parking_ratio: string | null;
  zoning: string | null;
  crexi_url: string | null;
  loopnet_url: string | null;
  description: string | null;
  notes: string | null;
}

const ASSET_TYPES = [
  "retail", "office", "industrial", "hospitality",
  "multifamily", "medical", "mixed_use", "land", "other",
];
const ROLES = ["listing_broker", "buyer_broker", "owner", "investor", "advisor"];

const num = (s: string): number | null => {
  if (s === "" || s === null || s === undefined) return null;
  const n = parseFloat(String(s).replace(/[$,%]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (s: string): number | null => {
  if (s === "" || s === null || s === undefined) return null;
  const n = parseInt(String(s).replace(/[$,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export function EditPropertyDialog({ open, property, onClose }: Props) {
  const router = useRouter();

  // Form state — initialized from the property; reset on each open.
  const [name, setName] = useState("");
  const [headline, setHeadline] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [zip, setZip] = useState("");
  const [assetType, setAssetType] = useState("retail");
  const [transactionType, setTransactionType] = useState<"sale" | "lease">("sale");
  const [yourRole, setYourRole] = useState("listing_broker");
  const [askingPrice, setAskingPrice] = useState("");
  const [leaseRate, setLeaseRate] = useState("");
  const [sqft, setSqft] = useState("");
  const [acreage, setAcreage] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [noi, setNoi] = useState("");
  // Cap rate stored as decimal in DB (0.075). We let the broker type a
  // percent (7.5) and convert on save.
  const [capRatePct, setCapRatePct] = useState("");
  const [pricePerSf, setPricePerSf] = useState("");
  const [occupancyPct, setOccupancyPctRaw] = useState("");
  const [parkingSpaces, setParkingSpaces] = useState("");
  const [parkingRatio, setParkingRatio] = useState("");
  const [zoning, setZoning] = useState("");
  const [crexiUrl, setCrexiUrl] = useState("");
  const [loopnetUrl, setLoopnetUrl] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate when opening — fetch the full row from the API so we have
  // every PATCHable column, not just the subset PropertyDetail exposes.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setHydrating(true);
    fetch(`/api/properties/${property.id}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        const p = json.property as FullPropertyRow;
        setName(p.name ?? "");
        setHeadline(p.headline ?? "");
        setAddress(p.address ?? "");
        setCity(p.city ?? "");
        setStateCode(p.state ?? "IN");
        setZip(p.zip ?? "");
        setAssetType(p.asset_type ?? "retail");
        setTransactionType((p.transaction_type as "sale" | "lease") || "sale");
        setYourRole(p.your_role ?? "listing_broker");
        setAskingPrice(p.asking_price ? String(p.asking_price) : "");
        setLeaseRate(p.lease_rate ? String(p.lease_rate) : "");
        setSqft(p.sqft ? String(p.sqft) : "");
        setAcreage(p.acreage ? String(p.acreage) : "");
        setYearBuilt(p.year_built ? String(p.year_built) : "");
        setNoi(p.noi ? String(p.noi) : "");
        setCapRatePct(
          p.cap_rate !== null && p.cap_rate !== undefined
            ? (Number(p.cap_rate) * 100).toFixed(2)
            : ""
        );
        setPricePerSf(p.price_per_sf ? String(p.price_per_sf) : "");
        setOccupancyPctRaw(
          p.occupancy_pct !== null && p.occupancy_pct !== undefined
            ? (Number(p.occupancy_pct) * 100).toFixed(0)
            : ""
        );
        setParkingSpaces(p.parking_spaces ? String(p.parking_spaces) : "");
        setParkingRatio(p.parking_ratio ?? "");
        setZoning(p.zoning ?? "");
        setCrexiUrl(p.crexi_url ?? "");
        setLoopnetUrl(p.loopnet_url ?? "");
        setDescription(p.description ?? "");
        setNotes(p.notes ?? "");
      })
      .catch((err) => setError(err?.message || String(err)))
      .finally(() => setHydrating(false));
  }, [open, property.id]);

  // ESC closes the modal — same pattern as the other dialogs in CRE OS.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      // Build a sparse payload — only fields with a value. Cleared fields
      // (set to "") become null. Cap rate / occupancy converted from
      // percent to decimal.
      const cap = num(capRatePct);
      const occ = num(occupancyPct);
      const payload: Record<string, any> = {
        name: orNull(name) ?? property.name,            // never null name
        headline: orNull(headline),
        address: orNull(address),
        city: orNull(city),
        state: orNull(stateCode),
        zip: orNull(zip),
        asset_type: orNull(assetType),
        transaction_type: transactionType,
        your_role: orNull(yourRole),
        asking_price: num(askingPrice),
        lease_rate: num(leaseRate),
        sqft: intOrNull(sqft),
        acreage: num(acreage),
        year_built: intOrNull(yearBuilt),
        noi: num(noi),
        cap_rate: cap !== null ? cap / 100 : null,
        price_per_sf: num(pricePerSf),
        occupancy_pct: occ !== null ? occ / 100 : null,
        parking_spaces: intOrNull(parkingSpaces),
        parking_ratio: orNull(parkingRatio),
        zoning: orNull(zoning),
        crexi_url: orNull(crexiUrl),
        loopnet_url: orNull(loopnetUrl),
        description: orNull(description),
        notes: orNull(notes),
      };

      const res = await fetch(`/api/properties/${property.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-3xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">Edit property</div>
            {/* PropertyDetail doesn't expose headline — use the loaded form
                value once hydrated, fall back to name otherwise. */}
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream truncate max-w-md">
              {headline || property.name}
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

        <div className="px-6 py-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {hydrating && (
            <div className="font-mono text-[10px] text-cream-subtle text-center py-2">
              Loading property…
            </div>
          )}
          <Section label="Identity" hint="The labels that show up on the workspace and on the public site.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Display name">
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Headline (marketing)" hint="One-liner used on listings and the owner portal.">
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Economy Hotel — 58 Keys, 3.57x Revenue"
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          <Section label="Location">
            <Field label="Address">
              <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
            </Field>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Field label="City">
                <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
              </Field>
              <Field label="State">
                <input value={stateCode} onChange={(e) => setStateCode(e.target.value)} maxLength={2} className={inputCls} />
              </Field>
              <Field label="Zip">
                <input value={zip} onChange={(e) => setZip(e.target.value)} className={inputCls} />
              </Field>
            </div>
          </Section>

          <Section label="Asset & deal">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Asset type">
                <select value={assetType} onChange={(e) => setAssetType(e.target.value)} className={inputCls}>
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>{t.replace("_", " ")}</option>
                  ))}
                </select>
              </Field>
              <Field label="Transaction">
                <select value={transactionType} onChange={(e) => setTransactionType(e.target.value as "sale" | "lease")} className={inputCls}>
                  <option value="sale">Sale</option>
                  <option value="lease">Lease</option>
                </select>
              </Field>
              <Field label="Your role">
                <select value={yourRole} onChange={(e) => setYourRole(e.target.value)} className={inputCls}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r.replace("_", " ")}</option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section label="Pricing & size">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label={transactionType === "lease" ? "Asking price (also)" : "Asking price"}>
                <input
                  inputMode="decimal"
                  value={askingPrice}
                  onChange={(e) => setAskingPrice(e.target.value)}
                  placeholder="2400000"
                  className={inputCls}
                />
              </Field>
              <Field label="Lease rate $/SF/yr">
                <input
                  inputMode="decimal"
                  value={leaseRate}
                  onChange={(e) => setLeaseRate(e.target.value)}
                  placeholder="24.50"
                  className={inputCls}
                />
              </Field>
              <Field label="Square feet">
                <input
                  inputMode="numeric"
                  value={sqft}
                  onChange={(e) => setSqft(e.target.value)}
                  placeholder="12500"
                  className={inputCls}
                />
              </Field>
              <Field label="Acreage">
                <input
                  inputMode="decimal"
                  value={acreage}
                  onChange={(e) => setAcreage(e.target.value)}
                  placeholder="2.4"
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          <Section label="Financials" hint="Cap rate and occupancy entered as percents (7.5, 92). Stored as decimals (0.075, 0.92).">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="NOI">
                <input
                  inputMode="decimal"
                  value={noi}
                  onChange={(e) => setNoi(e.target.value)}
                  placeholder="196000"
                  className={inputCls}
                />
              </Field>
              <Field label="Cap rate %">
                <input
                  inputMode="decimal"
                  value={capRatePct}
                  onChange={(e) => setCapRatePct(e.target.value)}
                  placeholder="7.50"
                  className={inputCls}
                />
              </Field>
              <Field label="Price per SF">
                <input
                  inputMode="decimal"
                  value={pricePerSf}
                  onChange={(e) => setPricePerSf(e.target.value)}
                  placeholder="196"
                  className={inputCls}
                />
              </Field>
              <Field label="Occupancy %">
                <input
                  inputMode="decimal"
                  value={occupancyPct}
                  onChange={(e) => setOccupancyPctRaw(e.target.value)}
                  placeholder="92"
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          <Section label="Building details">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Year built">
                <input
                  inputMode="numeric"
                  value={yearBuilt}
                  onChange={(e) => setYearBuilt(e.target.value)}
                  placeholder="2008"
                  className={inputCls}
                />
              </Field>
              <Field label="Parking spaces">
                <input
                  inputMode="numeric"
                  value={parkingSpaces}
                  onChange={(e) => setParkingSpaces(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Parking ratio">
                <input
                  value={parkingRatio}
                  onChange={(e) => setParkingRatio(e.target.value)}
                  placeholder="4.0/1000"
                  className={inputCls}
                />
              </Field>
              <Field label="Zoning">
                <input value={zoning} onChange={(e) => setZoning(e.target.value)} className={inputCls} />
              </Field>
            </div>
          </Section>

          <Section label="Syndication URLs" hint="Where the listing lives publicly. Site visibility is set in the Listings page.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="CREXi URL">
                <input
                  type="url"
                  value={crexiUrl}
                  onChange={(e) => setCrexiUrl(e.target.value)}
                  placeholder="https://www.crexi.com/properties/…"
                  className={inputCls}
                />
              </Field>
              <Field label="LoopNet URL">
                <input
                  type="url"
                  value={loopnetUrl}
                  onChange={(e) => setLoopnetUrl(e.target.value)}
                  placeholder="https://www.loopnet.com/Listing/…"
                  className={inputCls}
                />
              </Field>
            </div>
          </Section>

          <Section label="Long form">
            <Field label="Description" hint="Full marketing description used on the public site.">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className={`${inputCls} resize-y`}
              />
            </Field>
            <Field label="Internal notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Anything you want against the asset — owner intel, deal context, dealbreakers."
                className={`${inputCls} resize-y mt-3`}
              />
            </Field>
          </Section>

          {error && (
            <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.04]">
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
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

function Section({
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
      <div className="mb-2.5">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">{label}</div>
        {hint && <div className="mt-0.5 font-body text-[10.5px] text-cream-subtle">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

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
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</span>
      {hint && <span className="block mt-0.5 font-body text-[10px] text-cream-subtle">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
