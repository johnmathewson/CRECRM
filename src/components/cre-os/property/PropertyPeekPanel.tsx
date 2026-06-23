"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface PeekDeal {
  id: string;
  deal_name: string | null;
  deal_type: string | null;
  price: number | null;
  commission_pct: number | null;
  estimated_commission: number | null;
  weighted_commission: number | null;
  probability_pct: number | null;
  expected_close: string | null;
  stage: string | null;
}

/**
 * PropertyPeekPanel — right-side slide-over showing a compact
 * summary of one property without leaving the Properties page.
 *
 * Designed for fast browsing: open the panel to verify you're
 * looking at the right asset, see status / stage / price / SF /
 * lease structure (transaction-aware), then either close back
 * to your view or click through to the full workspace for deep
 * edits.
 *
 * Open state is URL-driven (?p=<slug> on /cre-os/properties) so
 * the panel is deep-linkable. Closing removes the param. ESC and
 * backdrop click both close.
 */

interface PeekData {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string | null;
  pipeline_stage: string | null;
  asset_type: string | null;
  sub_type: string | null;
  transaction_type: string | null;
  asking_price: number | null;
  lease_rate: number | null;
  sqft: number | null;
  available_sf: number | null;
  acreage: number | null;
  cap_rate: number | null;
  noi: number | null;
  lease_type: string | null;
  free_rent_months: number | null;
  ti_allowance_per_sf: number | null;
  operating_expenses_per_sf: number | null;
  headline: string | null;
  crexi_url: string | null;
  loopnet_url: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  images: any;
}

export function PropertyPeekPanel({
  propertyId,
  onClose,
}: {
  /** Property ID to load. Null = panel closed. */
  propertyId: string | null;
  onClose: () => void;
}) {
  const open = propertyId !== null;
  const [data, setData] = useState<PeekData | null>(null);
  const [deals, setDeals] = useState<PeekDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadDeals = useCallback(async (pid: string) => {
    const r = await fetch(`/api/properties/${pid}/deals`, { cache: "no-store" });
    const j = await r.json();
    if (Array.isArray(j?.deals)) setDeals(j.deals as PeekDeal[]);
  }, []);

  // Fetch property data when panel opens
  useEffect(() => {
    if (!propertyId) {
      setData(null);
      setDeals([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Property + deals in parallel — both feed the panel render and
    // there's no dependency between them.
    void reloadDeals(propertyId).catch(() => {});
    fetch(`/api/properties/${propertyId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.error) throw new Error(j.error);
        setData(j.property as PeekData);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [propertyId]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const isLease = data?.transaction_type === "lease";
  const heroImage = (() => {
    if (!data?.images) return null;
    const arr = Array.isArray(data.images) ? data.images : [];
    if (arr.length === 0) return null;
    const first = arr[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && typeof first.url === "string") return first.url;
    return null;
  })();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[105] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className="fixed top-0 right-0 z-[106] h-full w-full max-w-md bg-steward-base border-l border-white/[0.08] shadow-panel-soft flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] shrink-0">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            Property Peek
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/[0.06] text-cream-dim hover:text-cream transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-5 font-body text-[13px] text-cream-dim">Loading…</div>
          )}
          {error && (
            <div className="m-5 rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
              {error}
            </div>
          )}
          {data && !loading && (
            <>
              {/* Hero image */}
              {heroImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroImage}
                  alt={data.name}
                  className="w-full aspect-[16/10] object-cover bg-white/[0.03]"
                />
              )}

              <div className="p-5 space-y-5">
                {/* Identity */}
                <div>
                  <h2 className="font-heading text-xl font-semibold text-cream">{data.name}</h2>
                  <p className="mt-1 font-mono text-[11.5px] text-cream-dim">
                    {[data.address, data.city, data.state, data.zip].filter(Boolean).join(", ")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.status && <Badge tone="amber">{data.status.replace(/_/g, " ")}</Badge>}
                    {data.pipeline_stage && <Badge tone="coral">{data.pipeline_stage}</Badge>}
                    {data.transaction_type && (
                      <Badge tone="teal">{isLease ? "For Lease" : "For Sale"}</Badge>
                    )}
                  </div>
                </div>

                {/* Headline */}
                {data.headline && (
                  <p className="font-heading text-[14px] text-cream-dim italic leading-relaxed border-l-2 border-coral-400/40 pl-3">
                    {data.headline}
                  </p>
                )}

                {/* Key metrics — transaction-aware */}
                <div className="grid grid-cols-2 gap-3">
                  {isLease ? (
                    <>
                      <Metric
                        label="Lease Rate"
                        value={data.lease_rate ? `$${Number(data.lease_rate).toFixed(2)}/SF` : "—"}
                      />
                      <Metric
                        label="Available"
                        value={data.available_sf ? `${data.available_sf.toLocaleString()} SF` : "—"}
                      />
                      <Metric
                        label="Lease Type"
                        value={data.lease_type ? prettyLeaseType(data.lease_type) : "—"}
                      />
                      <Metric
                        label="Total Building"
                        value={data.sqft ? `${data.sqft.toLocaleString()} SF` : "—"}
                      />
                      {data.operating_expenses_per_sf && (
                        <Metric
                          label="NNN"
                          value={`$${Number(data.operating_expenses_per_sf).toFixed(2)}/SF`}
                        />
                      )}
                      {data.free_rent_months ? (
                        <Metric label="Free Rent" value={`${data.free_rent_months} mo`} />
                      ) : null}
                      {data.ti_allowance_per_sf ? (
                        <Metric
                          label="TI Allowance"
                          value={`$${Number(data.ti_allowance_per_sf).toFixed(2)}/SF`}
                        />
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Metric
                        label="Asking Price"
                        value={data.asking_price ? fmtMoney(data.asking_price) : "—"}
                      />
                      {data.cap_rate ? (
                        <Metric label="Cap Rate" value={`${(data.cap_rate * 100).toFixed(2)}%`} />
                      ) : null}
                      {data.sqft ? (
                        <Metric label="Building" value={`${data.sqft.toLocaleString()} SF`} />
                      ) : null}
                      {data.acreage ? (
                        <Metric label="Land" value={`${Number(data.acreage).toFixed(2)} AC`} />
                      ) : null}
                      {data.noi ? (
                        <Metric label="NOI" value={fmtMoney(data.noi)} />
                      ) : null}
                    </>
                  )}
                  <Metric
                    label="Asset Type"
                    value={[data.asset_type, data.sub_type].filter(Boolean).join(" / ").replace(/_/g, " ") || "—"}
                  />
                </div>

                {/* External listing links */}
                {(data.crexi_url || data.loopnet_url) && (
                  <div className="flex flex-wrap gap-2">
                    {data.crexi_url && (
                      <a
                        href={data.crexi_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream transition-colors"
                      >
                        CREXi ↗
                      </a>
                    )}
                    {data.loopnet_url && (
                      <a
                        href={data.loopnet_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream transition-colors"
                      >
                        LoopNet ↗
                      </a>
                    )}
                  </div>
                )}

                {/* Active deals — editable. Lets the broker fix a
                    stale deal price or set commission without leaving
                    the kanban → peek workflow. */}
                {deals.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-white/[0.06]">
                    <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
                      Active deal{deals.length === 1 ? "" : "s"} · {deals.length}
                    </div>
                    {deals.map((d) => (
                      <DealEditCard
                        key={d.id}
                        deal={d}
                        onSaved={() => propertyId && reloadDeals(propertyId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer — Open workspace */}
        {data && (
          <div className="px-5 py-3 border-t border-white/[0.06] shrink-0 bg-steward-base">
            <Link
              href={`/cre-os/properties/${data.slug}`}
              className="block w-full text-center px-4 py-2.5 rounded border border-coral-400/50 bg-coral-400/[0.12] hover:bg-coral-400/[0.22] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
            >
              Open full workspace →
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "coral" | "amber" | "teal" }) {
  const cls: Record<string, string> = {
    coral: "border-coral-400/40 bg-coral-400/[0.10] text-coral-300",
    amber: "border-amber-400/40 bg-amber-400/[0.10] text-amber-300",
    teal:  "border-teal-400/40 bg-teal-400/[0.10] text-teal-300",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border font-mono text-[10px] uppercase tracking-eyebrow ${cls[tone]}`}>
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
        {label}
      </div>
      <div className="mt-0.5 font-heading text-[13.5px] text-cream font-semibold truncate">
        {value}
      </div>
    </div>
  );
}

function fmtMoney(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000).toLocaleString() + "K";
  return "$" + n.toLocaleString();
}

function prettyLeaseType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/Nnn/i, "NNN");
}

// ── Inline deal-edit card ─────────────────────────────────────────────────

/**
 * DealEditCard — one row per open deal on the peeked property.
 *
 * Editable fields: price, commission %, est. commission. Save fires
 * PATCH /api/deals/[id] which auto-derives weighted_commission server-
 * side so the kanban rollups stay correct. Lease deals show the price
 * field as a rate ($/SF/yr) hint.
 *
 * Compact UX: inputs always visible (no edit-mode toggle), explicit
 * Save button so the broker can review before committing. Disables
 * inputs while saving so doubled clicks don't double-fire.
 */
function DealEditCard({
  deal,
  onSaved,
}: {
  deal: PeekDeal;
  onSaved: () => void;
}) {
  const isLease = deal.deal_type === "lease";
  const [price, setPrice] = useState<string>(deal.price !== null ? String(deal.price) : "");
  const [commissionPct, setCommissionPct] = useState<string>(
    deal.commission_pct !== null ? String(deal.commission_pct) : ""
  );
  const [estCommission, setEstCommission] = useState<string>(
    deal.estimated_commission !== null ? String(deal.estimated_commission) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Dirty flag — Save button stays disabled when nothing changed
  const dirty =
    price !== (deal.price !== null ? String(deal.price) : "") ||
    commissionPct !== (deal.commission_pct !== null ? String(deal.commission_pct) : "") ||
    estCommission !== (deal.estimated_commission !== null ? String(deal.estimated_commission) : "");

  // Sale-mode: auto-suggest est. commission from price × pct when broker
  // hasn't overridden it. Same UX pattern as CreateDealDialog.
  function onCommissionPctChange(v: string) {
    setCommissionPct(v);
    if (!isLease && price && estCommission === "") {
      const p = Number(price.replace(/[$,]/g, ""));
      const pct = Number(v.replace(/[%]/g, ""));
      if (!Number.isNaN(p) && !Number.isNaN(pct)) {
        setEstCommission(String(Math.round((p * pct) / 100)));
      }
    }
  }

  async function save() {
    setSaving(true);
    setSaveErr(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: Record<string, any> = {};
      const priceN = price === "" ? null : Number(price.replace(/[$,]/g, ""));
      const pctN = commissionPct === "" ? null : Number(commissionPct.replace(/[%]/g, ""));
      const estN = estCommission === "" ? null : Number(estCommission.replace(/[$,]/g, ""));
      if (priceN !== deal.price) payload.price = priceN;
      if (pctN !== deal.commission_pct) payload.commission_pct = pctN;
      if (estN !== deal.estimated_commission) payload.estimated_commission = estN;
      const r = await fetch(`/api/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setSavedAt(Date.now());
      onSaved();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full px-2 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] font-mono text-[11.5px] text-cream focus:outline-none focus:border-coral-400/50 disabled:opacity-50";

  return (
    <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-heading text-[12.5px] text-cream font-semibold truncate">
            {deal.deal_name ?? "(unnamed deal)"}
          </div>
          <div className="font-mono text-[10px] text-cream-subtle">
            {[deal.stage, deal.deal_type?.replace("_", " "), deal.probability_pct ? `${Math.round(deal.probability_pct)}%` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {deal.weighted_commission !== null && deal.weighted_commission > 0 && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Wtd comm</div>
            <div className="font-mono text-[11.5px] text-coral-300">
              {fmtMoney(deal.weighted_commission)}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-0.5">
            {isLease ? "Rate $/SF" : "Price"}
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            disabled={saving}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={isLease ? "24.50" : "2400000"}
            className={inputCls}
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-0.5">
            Comm %
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={commissionPct}
            disabled={saving}
            onChange={(e) => onCommissionPctChange(e.target.value)}
            placeholder="5"
            className={inputCls}
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-0.5">
            Est. comm $
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={estCommission}
            disabled={saving}
            onChange={(e) => setEstCommission(e.target.value)}
            placeholder="120000"
            className={inputCls}
          />
        </label>
      </div>

      {saveErr && (
        <div className="rounded border border-red-400/40 bg-red-500/[0.08] px-2 py-1 font-body text-[11px] text-red-300">
          {saveErr}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-cream-subtle">
          {savedAt && !dirty ? "Saved" : null}
        </span>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-3 py-1 rounded border border-coral-400/50 bg-coral-400/[0.12] hover:bg-coral-400/[0.22] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
