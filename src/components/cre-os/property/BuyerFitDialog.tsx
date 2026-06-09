"use client";

import { useState } from "react";

/**
 * BuyerFitDialog — quick-input modal for generating a 1-page buyer-fit
 * assessment PDF for a specific buyer. POSTs to
 * /api/properties/[id]/buyer-fit-assessment and triggers a download.
 *
 * Usage: broker enters the buyer's criteria (asset types, size range,
 * price ceiling, value-add narrative), clicks Generate, the PDF
 * downloads with a property-prefixed filename.
 */
export function BuyerFitDialog({
  open,
  onClose,
  propertyId,
  propertyName,
}: {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  propertyName: string;
}) {
  const [buyerLabel, setBuyerLabel] = useState("");
  const [assetTypesText, setAssetTypesText] = useState("Retail, Industrial");
  const [minSqft, setMinSqft] = useState<string>("10000");
  const [maxSqft, setMaxSqft] = useState<string>("200000");
  const [maxPrice, setMaxPrice] = useState<string>("20000000");
  const [thesesText, setThesesText] = useState<string>(
    "Value-add through lease-up, below-market rents, adaptable use."
  );
  const [marketRentPerSf, setMarketRentPerSf] = useState<string>("");
  const [markToMarketLiftPerSf, setMarkToMarketLiftPerSf] = useState<string>("");
  const [exitCapRate, setExitCapRate] = useState<string>("8.0");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}/buyer-fit-assessment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyerLabel: buyerLabel.trim() || undefined,
          assetTypes: assetTypesText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          minSqft: minSqft ? Number(minSqft) : undefined,
          maxSqft: maxSqft ? Number(maxSqft) : undefined,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
          thesesText: thesesText.trim() || undefined,
          marketRentPerSf: marketRentPerSf ? Number(marketRentPerSf) : undefined,
          markToMarketLiftPerSf: markToMarketLiftPerSf ? Number(markToMarketLiftPerSf) : undefined,
          exitCapRate: exitCapRate ? Number(exitCapRate) / 100 : undefined,
        }),
      });
      if (!r.ok) {
        const ct = r.headers.get("content-type") ?? "";
        const msg = ct.includes("application/json")
          ? (await r.json()).error ?? `HTTP ${r.status}`
          : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${propertyName.replace(/[^A-Za-z0-9_-]+/g, "_")}_buyer_fit.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.05]">
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300">
            Buyer-fit PDF
          </div>
          <div className="font-display text-[18px] text-cream mt-1">{propertyName}</div>
          <p className="font-body text-[11.5px] text-cream-dim mt-1.5">
            One-page assessment. Heavy focus on lease-up + mark-to-market upside, with a buyer-criteria match table.
          </p>
        </div>

        <div className="px-6 py-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <Field label="Buyer label (shown on the PDF)">
            <input
              type="text"
              value={buyerLabel}
              onChange={(e) => setBuyerLabel(e.target.value)}
              placeholder="Mark Stevens @ Stevens Capital"
              className={inputCls}
            />
          </Field>
          <Field label="Asset types (comma separated)">
            <input
              type="text"
              value={assetTypesText}
              onChange={(e) => setAssetTypesText(e.target.value)}
              placeholder="Retail, Industrial"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Min SF">
              <input
                type="number"
                value={minSqft}
                onChange={(e) => setMinSqft(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Max SF">
              <input
                type="number"
                value={maxSqft}
                onChange={(e) => setMaxSqft(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Max price (USD)">
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="20000000"
              className={inputCls}
            />
          </Field>
          <Field label="Value-add narrative">
            <textarea
              value={thesesText}
              onChange={(e) => setThesesText(e.target.value)}
              rows={3}
              className={`${inputCls} resize-y`}
              placeholder="e.g. value-add through lease-up, below-market rents, adaptable use"
            />
            <p className="mt-1 font-body text-[11px] text-cream-subtle">
              The PDF auto-detects keywords like &ldquo;lease-up&rdquo;, &ldquo;below-market&rdquo;, &ldquo;adaptable&rdquo; and adds matching match-table rows.
            </p>
          </Field>

          <div className="pt-3 border-t border-white/[0.05]">
            <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-2">
              Modeling assumptions (optional overrides)
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Market rent ($/SF NNN)">
                <input
                  type="number"
                  step="0.5"
                  value={marketRentPerSf}
                  onChange={(e) => setMarketRentPerSf(e.target.value)}
                  placeholder="16"
                  className={inputCls}
                />
              </Field>
              <Field label="M-to-M lift ($/SF)">
                <input
                  type="number"
                  step="0.5"
                  value={markToMarketLiftPerSf}
                  onChange={(e) => setMarkToMarketLiftPerSf(e.target.value)}
                  placeholder="3"
                  className={inputCls}
                />
              </Field>
              <Field label="Exit cap (%)">
                <input
                  type="number"
                  step="0.1"
                  value={exitCapRate}
                  onChange={(e) => setExitCapRate(e.target.value)}
                  placeholder="8.0"
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          {error && (
            <div className="rounded border border-coral-400/40 bg-coral-400/[0.08] px-3 py-2 font-body text-[11.5px] text-coral-300">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-white/[0.05] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 rounded border border-teal-400/50 bg-teal-400/[0.10] hover:bg-teal-400/[0.20] disabled:opacity-40 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-teal-300"
          >
            {generating ? "Generating…" : "Generate PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-teal-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
