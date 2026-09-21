/**
 * Seller tax estimate — Tier 1 (2026-09-21).
 *
 * Pure math, no DB, no fetch — same contract as seller-net.ts so it can be
 * imported into the marketing-site repo verbatim.
 *
 * Estimates the federal + Indiana tax a seller owes on a sale, from three
 * inputs the owner can usually answer without opening a file:
 *   • original purchase price
 *   • purchase date
 *   • capital improvements since purchase (default $0)
 *
 * Everything else is derived with documented assumptions (see DEFAULT_TAX
 * _RATES). Depreciation is ESTIMATED straight-line over the recovery period
 * on the building portion; an owner who did a cost-seg study or has an
 * actual depreciation schedule can override via `accumulated_depreciation`.
 *
 * Why three taxes on two pieces of gain: for a long-held commercial
 * building, unrecaptured §1250 depreciation is usually the majority of the
 * tax bill and is taxed at a flat 25% rather than the preferential LTCG
 * rate. Ignoring it — the common "gain × 20%" shortcut — understates the
 * bill by a third or more.
 *
 * The 1031 toggle deliberately produces $0 estimated tax with the deferred
 * amount surfaced separately: showing "pay $X now" beside "exchange and
 * keep $X working" is the single most persuasive thing this feature puts
 * in front of a seller.
 *
 * NOT TAX ADVICE. Every rendering carries a disclaimer; the number exists
 * to frame a conversation with the seller's CPA, not replace it.
 */

export interface TaxRateAssumptions {
  /** Unrecaptured §1250 gain (depreciation recapture) — federal max rate. */
  recapture_rate: number;
  /** Long-term capital gains rate applied to the non-recapture gain. */
  ltcg_rate: number;
  /** Net Investment Income Tax — applies when MAGI > $200K single / $250K MFJ. */
  niit_rate: number;
  /** State income tax rate on the whole gain. Indiana is flat. */
  state_rate: number;
  /** Portion of purchase price attributed to land (not depreciable). */
  land_pct: number;
  /** Straight-line recovery period in years. 39 nonresidential, 27.5 residential. */
  recovery_years: number;
}

/** Rates as of tax year 2026. Held in one place so a bracket change is a data edit. */
export const DEFAULT_TAX_RATES: TaxRateAssumptions = {
  recapture_rate: 0.25,
  ltcg_rate: 0.20,
  niit_rate: 0.038,
  state_rate: 0.03,
  land_pct: 0.20,
  recovery_years: 39,
};

export interface SellerTaxInputs {
  /** Net proceeds from the seller-net analysis (after commission + adjustments). */
  net_proceeds: number;
  original_purchase_price: number;
  /** ISO date (YYYY-MM-DD). Used to estimate years of depreciation taken. */
  purchase_date: string | null;
  /** Capital improvements since purchase — added to basis and depreciated from the midpoint. */
  capital_improvements: number;
  /** Override for estimated depreciation when the owner has real numbers. */
  accumulated_depreciation: number | null;
  /** Sale date for the depreciation clock. Defaults to today. */
  sale_date?: string | null;
  /** When true, all tax is deferred — estimate becomes $0 with the deferred amount surfaced. */
  intends_1031: boolean;
  /** Apply NIIT. Default true — most commercial sellers exceed the MAGI threshold in a sale year. */
  apply_niit?: boolean;
  rates?: Partial<TaxRateAssumptions>;
}

export interface SellerTaxEstimate {
  rates: TaxRateAssumptions;
  years_held: number;
  depreciable_basis: number;
  /** Estimated (or overridden) depreciation taken to date. */
  accumulated_depreciation: number;
  depreciation_is_estimated: boolean;
  adjusted_basis: number;
  total_gain: number;
  recapture_gain: number;
  ltcg_gain: number;
  federal_recapture_tax: number;
  federal_ltcg_tax: number;
  niit_tax: number;
  state_tax: number;
  /** Sum of the four taxes — what a cash sale costs. */
  estimated_tax: number;
  /** estimated_tax when intends_1031 is false; 0 when true. */
  tax_due_now: number;
  /** estimated_tax when intends_1031 is true — the money that stays working; 0 otherwise. */
  tax_deferred_via_1031: number;
  after_tax_proceeds: number;
  effective_rate_on_gain: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

function yearsBetween(fromIso: string | null | undefined, toIso: string | null | undefined): number {
  if (!fromIso) return 0;
  const from = new Date(fromIso);
  const to = toIso ? new Date(toIso) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, (to.getTime() - from.getTime()) / (365.25 * 86_400_000));
}

export function computeSellerTaxEstimate(inputs: SellerTaxInputs): SellerTaxEstimate {
  const rates: TaxRateAssumptions = { ...DEFAULT_TAX_RATES, ...(inputs.rates ?? {}) };
  const netProceeds = num(inputs.net_proceeds);
  const purchasePrice = num(inputs.original_purchase_price);
  const improvements = num(inputs.capital_improvements);
  const yearsHeld = yearsBetween(inputs.purchase_date, inputs.sale_date);

  // Building portion of the purchase price depreciates from the purchase
  // date; improvements depreciate from roughly the midpoint of the hold
  // (we don't know when they were made — midpoint is the unbiased guess).
  const buildingBasis = purchasePrice * (1 - rates.land_pct);
  const depreciableBasis = buildingBasis + improvements;
  const estimatedDep = Math.min(
    depreciableBasis,
    (buildingBasis * Math.min(yearsHeld, rates.recovery_years)) / rates.recovery_years +
      (improvements * Math.min(yearsHeld / 2, rates.recovery_years)) / rates.recovery_years,
  );
  const depIsEstimated =
    inputs.accumulated_depreciation === null || inputs.accumulated_depreciation === undefined;
  const accumulatedDep = depIsEstimated ? estimatedDep : Math.max(0, num(inputs.accumulated_depreciation));

  const adjustedBasis = purchasePrice + improvements - accumulatedDep;
  const totalGain = netProceeds - adjustedBasis;

  // Recapture is capped at depreciation taken and can't exceed the gain;
  // a loss sale has no recapture and no tax.
  const recaptureGain = Math.max(0, Math.min(accumulatedDep, totalGain));
  const ltcgGain = Math.max(0, totalGain - recaptureGain);

  const federalRecapture = recaptureGain * rates.recapture_rate;
  const federalLtcg = ltcgGain * rates.ltcg_rate;
  const applyNiit = inputs.apply_niit !== false;
  const niit = applyNiit ? Math.max(0, totalGain) * rates.niit_rate : 0;
  const state = Math.max(0, totalGain) * rates.state_rate;
  const estimatedTax = federalRecapture + federalLtcg + niit + state;

  const taxDueNow = inputs.intends_1031 ? 0 : estimatedTax;
  const deferred = inputs.intends_1031 ? estimatedTax : 0;

  return {
    rates,
    years_held: yearsHeld,
    depreciable_basis: depreciableBasis,
    accumulated_depreciation: accumulatedDep,
    depreciation_is_estimated: depIsEstimated,
    adjusted_basis: adjustedBasis,
    total_gain: totalGain,
    recapture_gain: recaptureGain,
    ltcg_gain: ltcgGain,
    federal_recapture_tax: federalRecapture,
    federal_ltcg_tax: federalLtcg,
    niit_tax: niit,
    state_tax: state,
    estimated_tax: estimatedTax,
    tax_due_now: taxDueNow,
    tax_deferred_via_1031: deferred,
    after_tax_proceeds: netProceeds - taxDueNow,
    effective_rate_on_gain: totalGain > 0 ? estimatedTax / totalGain : 0,
  };
}

export const TAX_ESTIMATE_DISCLAIMER =
  "Estimate for discussion purposes only. Assumes federal long-term capital gains and depreciation-recapture " +
  "rates, Net Investment Income Tax, and Indiana state tax at current published rates, with straight-line " +
  "depreciation estimated on the building portion of the original purchase price. Actual liability depends on " +
  "the seller's basis records, filing status, entity structure, and other income. Not tax or legal advice — " +
  "confirm with a CPA before relying on this figure.";

// ── Persistence helpers (shared by POST + PATCH so the snapshot logic can't drift) ──

export const TAX_INPUT_COLUMNS = [
  "tax_original_purchase_price",
  "tax_purchase_date",
  "tax_capital_improvements",
  "tax_accumulated_depreciation",
  "tax_intends_1031",
] as const;

/**
 * Given a merged row (existing + incoming tax_* fields) and its net
 * proceeds, produce the computed_tax_* columns to write. Returns nulls
 * when there's no purchase price — an offer without basis info simply has
 * no estimate, never a bogus one.
 */
export function taxSnapshotColumns(row: {
  tax_original_purchase_price?: number | string | null;
  tax_purchase_date?: string | null;
  tax_capital_improvements?: number | string | null;
  tax_accumulated_depreciation?: number | string | null;
  tax_intends_1031?: boolean | null;
  offer_date?: string | null;
}, netProceeds: number): Record<string, unknown> {
  const pp = num(row.tax_original_purchase_price);
  if (!pp) {
    return {
      computed_estimated_tax: null,
      computed_tax_deferred_1031: null,
      computed_after_tax_proceeds: null,
      computed_tax_breakdown: null,
    };
  }
  const est = computeSellerTaxEstimate({
    net_proceeds: netProceeds,
    original_purchase_price: pp,
    purchase_date: row.tax_purchase_date ?? null,
    capital_improvements: num(row.tax_capital_improvements),
    accumulated_depreciation:
      row.tax_accumulated_depreciation === null || row.tax_accumulated_depreciation === undefined
        ? null
        : num(row.tax_accumulated_depreciation),
    sale_date: row.offer_date ?? null,
    intends_1031: !!row.tax_intends_1031,
  });
  return {
    computed_estimated_tax: est.estimated_tax,
    computed_tax_deferred_1031: est.tax_deferred_via_1031,
    computed_after_tax_proceeds: est.after_tax_proceeds,
    computed_tax_breakdown: est,
  };
}
