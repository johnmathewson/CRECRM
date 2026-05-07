"use client";

import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * Valuation tab — the asset's pricing thesis on one screen. Three panels:
 *   1. Carried valuation (what's on the record now)
 *   2. Comp-implied value (what nearby comps suggest)
 *   3. Tension callouts + a CTA to run a fresh BOV in the valuation tool
 *
 * v1 reads pre-aggregated comp stats from property-queries (city/asset_type
 * filtered medians). Phase 2.5 will hook find_nearby_comps via the property's
 * lat/lng once we have geocoded coordinates on every record.
 */
export function ValuationTab({ p }: { p: PropertyDetail }) {
  const v = p.valuation;
  const carriedValue = p.askingPrice;
  const compImpliedValue =
    v.saleCompPpsf && p.sqft ? Math.round(v.saleCompPpsf.mid * p.sqft) : null;
  const tensionPct =
    carriedValue && compImpliedValue
      ? ((carriedValue - compImpliedValue) / compImpliedValue) * 100
      : null;

  const fullAddress = [p.address, p.city, p.state].filter(Boolean).join(", ");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Panel eyebrow="Carried valuation" num={1} title="What's on the record">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          <FactRow label="Asking price" value={fmtMoney(carriedValue)} />
          <FactRow label="$/SF" value={p.askingPrice && p.sqft ? "$" + (p.askingPrice / p.sqft).toFixed(2) : "—"} />
          <FactRow label="In-place NOI" value={fmtMoney(p.noi)} />
          <FactRow label="Cap rate" value={p.capRate ? (p.capRate * 100).toFixed(2) + "%" : "—"} />
          <FactRow label="Total SF" value={p.sqft ? p.sqft.toLocaleString() : "—"} />
          <FactRow label="Year built" value={p.yearBuilt ? String(p.yearBuilt) : "—"} />
        </div>

        <div className="mt-5 pt-4 border-t border-white/[0.04]">
          <a
            href={`/valuate?address=${encodeURIComponent(fullAddress || p.name)}`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded border border-coral-400/40 bg-coral-400/[0.06] text-coral-300 hover:bg-coral-400/[0.10] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
          >
            Run fresh BOV →
          </a>
          <p className="mt-2 font-mono text-[10px] text-cream-subtle">
            Opens the valuation tool with this address pre-filled. Generates BOV Sale, Rental Opinion, and Stabilized Valuation PDFs.
          </p>
        </div>
      </Panel>

      <Panel eyebrow="Comp-implied" num={2} title="What the market suggests">
        {v.compCount === 0 && !v.saleCompPpsf ? (
          <p className="font-body text-[13px] text-cream-subtle py-6">
            No comparable {p.assetType} comps found in {p.city || "this submarket"}. Add this property's geocoded coordinates and the engine will pull comps within a 3-mile radius automatically.
          </p>
        ) : (
          <div className="space-y-4">
            {v.compMedianRent !== null && (
              <div>
                <Eyebrow tone="teal">Lease comps</Eyebrow>
                <div className="mt-2 flex items-baseline justify-between">
                  <div>
                    <div className="font-display text-2xl text-cream">${v.compMedianRent.toFixed(2)}<span className="ml-1 font-mono text-[10px] text-cream-subtle">/SF/yr</span></div>
                    <div className="font-mono text-[10px] text-cream-subtle">
                      Median across {v.compCount} comp{v.compCount === 1 ? "" : "s"} in {p.city}
                    </div>
                  </div>
                  {p.sqft && (
                    <div className="text-right">
                      <div className="font-heading text-[12px] text-cream">Implied PGI</div>
                      <div className="font-mono text-[12px] text-teal-300">{fmtMoney(v.compMedianRent * p.sqft)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {v.saleCompPpsf && (
              <div className="pt-4 border-t border-white/[0.04]">
                <Eyebrow tone="coral">Sale comps · $/SF range</Eyebrow>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <RangeTile label="Low" value={v.saleCompPpsf.low} />
                  <RangeTile label="Mid" value={v.saleCompPpsf.mid} accent />
                  <RangeTile label="High" value={v.saleCompPpsf.high} />
                </div>
                <div className="mt-2 font-mono text-[10px] text-cream-subtle">
                  Trimmed across {v.saleCompPpsf.count} sale comp{v.saleCompPpsf.count === 1 ? "" : "s"}
                </div>

                {compImpliedValue && p.sqft && (
                  <div className="mt-4 pt-3 border-t border-white/[0.04]">
                    <div className="font-heading text-[12px] text-cream">Implied value at comp midpoint</div>
                    <div className="font-display text-2xl text-cream mt-1">{fmtMoney(compImpliedValue)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Panel>

      {tensionPct !== null && Math.abs(tensionPct) > 5 && (
        <Panel
          eyebrow="Pricing tension"
          num={3}
          title={tensionPct > 0 ? "Carried above comp midpoint" : "Carried below comp midpoint"}
          variant="elevated"
          className="lg:col-span-2"
        >
          <div className="flex items-baseline gap-4 flex-wrap">
            <div>
              <div className="font-display text-3xl text-cream">{tensionPct > 0 ? "+" : ""}{tensionPct.toFixed(1)}%</div>
              <div className="font-mono text-[10px] text-cream-subtle">vs comp midpoint</div>
            </div>
            <div className="flex-1 min-w-[200px]">
              <p className="font-body text-[13px] text-cream-dim leading-relaxed">
                {tensionPct > 0
                  ? "Asking exceeds the comp midpoint by a material margin. Be prepared with the pricing narrative — building quality, lease term, tenant credit, location premium — that justifies the spread."
                  : "Asking sits below the comp midpoint. Confirm the discount is intentional (off-market, distressed, condition) or revisit pricing."}
              </p>
            </div>
            <StatusBadge tone={tensionPct > 0 ? "amber" : "teal"}>
              {tensionPct > 0 ? "Above market" : "Below market"}
            </StatusBadge>
          </div>
        </Panel>
      )}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-0.5 font-heading text-[14px] text-cream">{value}</div>
    </div>
  );
}

function RangeTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded p-2 border ${accent ? "border-coral-400/30 bg-coral-400/[0.05]" : "border-white/[0.05] bg-white/[0.02]"}`}>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-0.5 font-display text-lg ${accent ? "text-coral-300" : "text-cream"}`}>${value.toFixed(2)}</div>
      <div className="font-mono text-[9px] text-cream-subtle">/SF</div>
    </div>
  );
}
