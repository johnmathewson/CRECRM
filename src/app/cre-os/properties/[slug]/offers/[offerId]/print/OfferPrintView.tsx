"use client";

import { useEffect } from "react";
import type { SellerNetInputs, SellerNetTotals } from "@/lib/seller-net";

/**
 * OfferPrintView — the actual rendered seller-net summary, styled for a
 * clean PDF artifact via print CSS. Auto-fires `window.print()` on mount
 * unless ?noprint is in the URL (so a broker can preview without the
 * dialog popping).
 */

const fmtMoneyExact = (n: number | null | undefined) =>
  n !== null && n !== undefined && Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    : "$0";

const fmtMoneyPretty = (n: number | null | undefined) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
};

export function OfferPrintView({
  property,
  offer,
  inputs,
  totals,
}: {
  property: any;
  offer: any;
  inputs: SellerNetInputs;
  totals: SellerNetTotals;
}) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.search.includes("noprint")) return;
    // Slight delay so layout settles before the dialog pops
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, []);

  const fullAddress = [property.address, property.city, property.state, property.zip].filter(Boolean).join(", ");
  const offerPrice = inputs.offer_price;
  const today = offer.offer_date ?? new Date().toISOString().slice(0, 10);

  return (
    <>
      {/* Print-specific styles. Live styles are inline so this page works
          standalone without the main app shell. Color tokens match the
          Stewardship brand (charcoal + coral). */}
      <style>{`
        @page {
          size: letter;
          margin: 0.5in 0.55in;
        }
        :root {
          --charcoal-950: #0D0D0D;
          --charcoal-900: #1A1A1A;
          --charcoal-700: #383838;
          --charcoal-500: #666666;
          --charcoal-400: #818181;
          --charcoal-300: #A4A4A4;
          --cream-100: #F0EDE4;
          --cream-200: #E5E0D8;
          --coral-300: #EA9A82;
          --coral-400: #E07A5F;
          --coral-500: #C66648;
          --teal-400: #4ECDC4;
        }
        html, body {
          background: white;
          color: var(--charcoal-950);
          font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
          font-size: 11px;
          line-height: 1.45;
          margin: 0;
          padding: 0;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .doc { max-width: 7.5in; margin: 0 auto; padding: 24px 0; }
        .brand { display: flex; align-items: baseline; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid var(--charcoal-950); margin-bottom: 22px; }
        .brand h1 { margin: 0; font-family: 'Space Grotesk', system-ui, sans-serif; font-size: 22px; font-weight: 500; letter-spacing: 0.04em; color: var(--charcoal-950); }
        .brand .sub { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--coral-500); margin-top: 3px; }
        .brand .meta { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--charcoal-500); }
        h2 { font-family: 'Space Grotesk', system-ui, sans-serif; font-size: 16px; font-weight: 500; color: var(--charcoal-950); margin: 0 0 4px; line-height: 1.2; }
        .label-line { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--charcoal-500); margin-bottom: 6px; }
        .property-card { border: 1px solid var(--charcoal-700); border-radius: 4px; padding: 12px 14px; background: #FAFAF8; margin-bottom: 18px; }
        .facts { display: flex; flex-wrap: wrap; gap: 12px 22px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; color: var(--charcoal-500); margin-top: 6px; }
        .facts span b { color: var(--charcoal-950); font-weight: 600; }
        .section { margin-bottom: 18px; page-break-inside: avoid; }
        .table { width: 100%; border-collapse: collapse; }
        .table td, .table th { padding: 6px 8px; text-align: left; vertical-align: top; }
        .table th { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--charcoal-500); border-bottom: 1px solid var(--charcoal-700); }
        .table td { border-bottom: 1px solid #E5E0D8; }
        .num { font-family: 'JetBrains Mono', ui-monospace, monospace; text-align: right; }
        .num.muted { color: var(--charcoal-400); }
        .num.debit { color: var(--coral-500); }
        .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .summary .panel { border: 1px solid var(--charcoal-700); border-radius: 4px; padding: 14px; }
        .summary .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
        .summary .row.muted { color: var(--charcoal-400); }
        .summary .row.divider { border-top: 1px solid #E5E0D8; margin: 6px 0; padding: 0; }
        .summary .row.headline { font-size: 14px; font-weight: 600; color: var(--coral-500); padding: 6px 0; }
        .summary .row .num { font-weight: 500; }
        .partner-block { margin-top: 14px; }
        .partner-row { border: 1px solid #E5E0D8; padding: 8px 10px; border-radius: 3px; margin-bottom: 8px; }
        .partner-row .name { font-weight: 600; font-size: 11.5px; }
        .partner-row .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 12px; margin-top: 6px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; color: var(--charcoal-500); }
        .partner-row .grid b { color: var(--charcoal-950); font-weight: 600; }
        .partner-row .grid .accent b { color: var(--coral-500); }
        .footer { margin-top: 28px; padding-top: 14px; border-top: 1px solid #E5E0D8; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 8.5px; color: var(--charcoal-500); display: flex; justify-content: space-between; }
        .notes { font-style: italic; color: var(--charcoal-700); border-left: 2px solid var(--coral-400); padding-left: 10px; font-size: 10.5px; }
        .toolbar { background: var(--charcoal-950); color: var(--cream-100); padding: 10px 14px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; display: flex; gap: 12px; align-items: center; }
        .toolbar a, .toolbar button { color: var(--coral-400); background: transparent; border: 1px solid var(--coral-400); padding: 4px 10px; border-radius: 3px; font: inherit; text-decoration: none; cursor: pointer; }
        .toolbar a:hover, .toolbar button:hover { background: rgba(224, 122, 95, 0.15); }
        @media print {
          .toolbar { display: none; }
          html, body { background: white; }
        }
      `}</style>

      {/* Hidden in print — top toolbar with manual "Print" + close-tab hint */}
      <div className="toolbar">
        <span>Stewardship CRE — Seller Net Summary</span>
        <span style={{ marginLeft: "auto" }}>If the print dialog didn't open,</span>
        <button type="button" onClick={() => window.print()}>Print or save as PDF</button>
      </div>

      <div className="doc">
        {/* Brand header */}
        <div className="brand">
          <div>
            <h1>STEWARDSHIP</h1>
            <div className="sub">Seller-Net Analysis</div>
          </div>
          <div className="meta">
            {new Date(today).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            <br />
            stewardshipcre.com
          </div>
        </div>

        {/* Property identification */}
        <div className="property-card">
          <div className="label-line">Subject property</div>
          <h2>{property.headline || property.name}</h2>
          {fullAddress && (
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--charcoal-500)", marginTop: 3 }}>
              {fullAddress}
            </div>
          )}
          <div className="facts">
            {property.asset_type && <span>Type <b>{String(property.asset_type).replace("_", " ")}</b></span>}
            {property.transaction_type && <span>Transaction <b>{String(property.transaction_type)}</b></span>}
            {property.sqft && <span>Size <b>{Number(property.sqft).toLocaleString()} SF</b></span>}
            {property.asking_price && <span>Asking <b>{fmtMoneyExact(property.asking_price)}</b></span>}
          </div>
        </div>

        {/* Offer header */}
        <div className="section">
          <div className="label-line">Offer scenario</div>
          <h2>{offer.title}</h2>
          {(offer.buyer_name || offer.offer_date) && (
            <div style={{ fontSize: 11, color: "var(--charcoal-500)", marginTop: 2 }}>
              {offer.buyer_name && <span><b style={{ color: "var(--charcoal-950)" }}>{offer.buyer_name}</b></span>}
              {offer.buyer_name && offer.offer_date && <span> · </span>}
              {offer.offer_date && (
                <span>
                  Dated{" "}
                  {new Date(offer.offer_date).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Line items table */}
        <div className="section">
          <div className="label-line">Closing-cost reconciliation</div>
          <table className="table">
            <thead>
              <tr>
                <th>Line</th>
                <th style={{ textAlign: "right", width: "120px" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Offer price</td>
                <td className="num"><b>{fmtMoneyExact(offerPrice)}</b></td>
              </tr>
              <tr>
                <td>Commission{inputs.commission_pct !== null && inputs.commission_pct !== undefined ? ` (${inputs.commission_pct}%)` : ""}</td>
                <td className="num debit">-{fmtMoneyExact(totals.commission)}</td>
              </tr>
              {(inputs.line_items ?? []).map((li, i) => (
                <tr key={i}>
                  <td>{li.label || (li.sign === "credit" ? "Credit" : "Debit")}</td>
                  <td className={`num ${li.sign === "debit" ? "debit" : ""}`}>
                    {li.sign === "debit" ? "-" : "+"}
                    {fmtMoneyExact(li.amount)}
                  </td>
                </tr>
              ))}
              <tr>
                <td><b>Net proceeds</b></td>
                <td className="num"><b style={{ color: "var(--coral-500)" }}>{fmtMoneyExact(totals.net_proceeds)}</b></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Partner waterfall (only if we have any) */}
        {totals.partner_breakdown.length > 0 && (
          <div className="section partner-block">
            <div className="label-line">Partner equity waterfall</div>
            {totals.partner_breakdown.map((p, i) => (
              <div key={i} className="partner-row">
                <div className="name">{p.name}</div>
                <div className="grid">
                  <span>Capital: <b>{fmtMoneyExact(p.capital)}</b></span>
                  <span>
                    Preferred: <b>{fmtMoneyExact(p.preferred_return)}</b>
                  </span>
                  <span>
                    Residual share: <b>{fmtMoneyExact(p.residual_share)}</b>
                  </span>
                  <span className="accent">
                    Total dist: <b>{fmtMoneyExact(p.total_distribution)}</b>
                  </span>
                </div>
              </div>
            ))}

            {/* Bottom-line summary */}
            <div className="summary" style={{ marginTop: 14 }}>
              <div className="panel">
                <div className="label-line">Net proceeds</div>
                <div className="row"><span>Offer</span><span className="num">{fmtMoneyExact(offerPrice)}</span></div>
                <div className="row muted"><span>Commission</span><span className="num">-{fmtMoneyExact(totals.commission)}</span></div>
                <div className="row muted">
                  <span>Adjustments (net)</span>
                  <span className="num">
                    {totals.adjustments >= 0 ? "+" : ""}
                    {fmtMoneyExact(totals.adjustments)}
                  </span>
                </div>
                <div className="row divider" />
                <div className="row headline">
                  <span>Net proceeds</span>
                  <span className="num">{fmtMoneyExact(totals.net_proceeds)}</span>
                </div>
              </div>
              <div className="panel">
                <div className="label-line">After partners</div>
                <div className="row">
                  <span>Net proceeds</span>
                  <span className="num">{fmtMoneyExact(totals.net_proceeds)}</span>
                </div>
                <div className="row muted">
                  <span>Partners owed (capital + pref)</span>
                  <span className="num">-{fmtMoneyExact(totals.partners_due)}</span>
                </div>
                <div className="row divider" />
                <div className="row headline">
                  <span>Sponsor / common residual</span>
                  <span className="num">{fmtMoneyExact(totals.sponsor_residual)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Notes (only if present) */}
        {offer.notes && (
          <div className="section">
            <div className="label-line">Notes</div>
            <div className="notes">{offer.notes}</div>
          </div>
        )}

        {/* Footer */}
        <div className="footer">
          <span>Stewardship CRE — confidential, do not distribute</span>
          <span>
            Generated{" "}
            {new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
    </>
  );
}
