/**
 * 1031 exchange rollover — replacement-property projection.
 *
 * Pure math, same contract as seller-net.ts / seller-tax-estimate.ts.
 *
 * Answers the seller's real question when they tick "1031": "OK — what do
 * I get if I roll it?" Given a hypothetical replacement price, cap rate,
 * and financing, projects the income on the new asset and — critically —
 * checks the two IRS rules that decide whether the exchange is actually
 * fully tax-deferred:
 *
 *   1. VALUE RULE   — replacement price must be ≥ relinquished net sale
 *                     price, or the shortfall is taxable "cash boot".
 *   2. DEBT RULE    — debt paid off at the sale must be replaced with ≥ debt
 *                     on the new property (or offset with fresh cash), or the
 *                     shortfall is taxable "mortgage boot".
 *
 * A seller with no mortgage (Dietrich, 8474 Colorado) has a $0 debt rule;
 * the field still exists because most sellers aren't in that position.
 *
 * The relinquished-side numbers come from the seller-net analysis: net
 * sale price = offer − commission − closing debits (excluding the mortgage
 * payoff, which is the debt being replaced, not a cost). Equity available
 * = net proceeds after the mortgage payoff. Both are derived, never
 * re-entered.
 */

export interface ExchangeInputs {
  /** Offer price less commission and non-mortgage closing adjustments. */
  relinquished_net_sale_price: number;
  /** Mortgage paid off at closing on the relinquished property. */
  relinquished_debt_paid_off: number;
  /** Cash the seller walks away with (net proceeds after mortgage payoff). */
  equity_available: number;
  /** Tax that a cash sale would have triggered — what the exchange defers. */
  tax_deferred: number;

  /** Hypothetical replacement property. */
  replacement_price: number;
  /** Going-in cap rate on the replacement, as a fraction (0.0775 = 7.75%). */
  replacement_cap_rate: number;
  /** New loan on the replacement. 0 = all-cash. */
  replacement_loan_amount: number;
  replacement_loan_rate: number;
  replacement_loan_amort_years: number;
  /** Buyer-side closing costs on the replacement, as a fraction of price. */
  replacement_closing_cost_pct: number;
  /**
   * Fresh cash the seller adds beyond the exchange equity (to cover a price
   * gap, replace debt without a loan, or just buy bigger). Default 0.
   */
  additional_cash: number;
  /**
   * Lender constraints for the "how much MORE could they borrow" test.
   * Headroom = (lesser of LTV-max and DSCR-max loan) − loan placed.
   * Loan proceeds aren't income, so a post-closing cash-out against the
   * replacement is tax-free cash — the answer to "but I need liquidity".
   */
  max_ltv?: number;
  min_dscr?: number;
}

export interface ExchangeProjection {
  // ── Replacement economics ──
  replacement_noi: number;
  replacement_closing_costs: number;
  /** Cash required at closing = price + costs − loan. */
  cash_required: number;
  /** Exchange equity + additional cash. */
  cash_available: number;
  /** cash_available − cash_required. Negative = seller must bring more. */
  cash_surplus: number;
  annual_debt_service: number;
  cash_flow_after_debt: number;
  /** cash_flow_after_debt ÷ total cash invested. */
  cash_on_cash: number;
  dscr: number | null;
  /** Loan placed ÷ replacement price. */
  ltv: number;

  // ── Leverage headroom (tax-free cash-out path) ──
  max_loan_by_ltv: number;
  max_loan_by_dscr: number;
  /** Lesser of the two — what a lender would actually extend. */
  max_supportable_loan: number;
  /** max_supportable_loan − loan placed. 0 when already at/over the limit. */
  additional_borrowing_capacity: number;
  /** Which constraint binds: "ltv" | "dscr". */
  binding_constraint: "ltv" | "dscr";
  /** Debt service, cash flow, CoC, and DSCR if levered to the max. */
  fully_levered: {
    loan: number;
    ltv: number;
    annual_debt_service: number;
    cash_flow_after_debt: number;
    cash_in_deal: number;
    cash_on_cash: number;
    dscr: number | null;
    /** Cash back in the seller's pocket = capacity pulled out (tax-free). */
    cash_out: number;
  };

  // ── Deferral test ──
  value_shortfall: number;
  debt_shortfall: number;
  /** Fresh cash can offset a debt shortfall dollar-for-dollar. */
  debt_shortfall_after_cash: number;
  taxable_boot: number;
  /** Rough tax on the boot at the blended effective rate of the deferred amount. */
  estimated_tax_on_boot: number;
  /** tax_deferred − estimated_tax_on_boot. */
  tax_actually_deferred: number;
  fully_deferred: boolean;

  // ── Comparison to a cash sale ──
  /** After-tax cash if they DON'T exchange: equity − tax. */
  cash_sale_after_tax: number;
  /** Equity working in the replacement = cash_available (no tax leakage). */
  exchange_equity_working: number;
  equity_advantage: number;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

function annualDebtService(principal: number, rate: number, amortYears: number): number {
  if (principal <= 0) return 0;
  if (rate <= 0) return amortYears > 0 ? principal / amortYears : 0;
  const r = rate / 12;
  const n = Math.max(1, Math.round(amortYears * 12));
  return (principal * r / (1 - Math.pow(1 + r, -n))) * 12;
}

export function computeExchangeProjection(inputs: ExchangeInputs): ExchangeProjection {
  const netSale = num(inputs.relinquished_net_sale_price);
  const debtOff = num(inputs.relinquished_debt_paid_off);
  const equity = num(inputs.equity_available);
  const deferred = num(inputs.tax_deferred);

  const price = num(inputs.replacement_price);
  const cap = num(inputs.replacement_cap_rate);
  const loan = Math.min(num(inputs.replacement_loan_amount), price);
  const rate = num(inputs.replacement_loan_rate);
  const amort = num(inputs.replacement_loan_amort_years) || 25;
  const costPct = num(inputs.replacement_closing_cost_pct);
  const addCash = num(inputs.additional_cash);

  // ── Replacement economics ──
  const noi = price * cap;
  const closing = price * costPct;
  const cashRequired = price + closing - loan;
  const cashAvailable = equity + addCash;
  const cashSurplus = cashAvailable - cashRequired;
  const ds = annualDebtService(loan, rate, amort);
  const cfads = noi - ds;
  const cashInvested = Math.max(cashRequired, 0);
  const coc = cashInvested > 0 ? cfads / cashInvested : 0;
  const dscr = ds > 0 ? noi / ds : null;
  const ltv = price > 0 ? loan / price : 0;

  // ── Leverage headroom ──
  const maxLtv = inputs.max_ltv ?? 0.65;
  const minDscr = inputs.min_dscr ?? 1.25;
  const constant = annualDebtService(1, rate, amort); // debt service per $1 of loan
  const maxByLtv = price * maxLtv;
  const maxByDscr = constant > 0 && minDscr > 0 ? noi / minDscr / constant : maxByLtv;
  const maxLoan = Math.max(0, Math.min(maxByLtv, maxByDscr));
  const headroom = Math.max(0, maxLoan - loan);
  const binding: "ltv" | "dscr" = maxByLtv <= maxByDscr ? "ltv" : "dscr";
  const flDs = annualDebtService(maxLoan, rate, amort);
  const flCf = noi - flDs;
  // Cash left in the deal after pulling the headroom out
  const flCashIn = Math.max(0, cashInvested - headroom);
  const fullyLevered = {
    loan: maxLoan,
    ltv: price > 0 ? maxLoan / price : 0,
    annual_debt_service: flDs,
    cash_flow_after_debt: flCf,
    cash_in_deal: flCashIn,
    cash_on_cash: flCashIn > 0 ? flCf / flCashIn : 0,
    dscr: flDs > 0 ? noi / flDs : null,
    cash_out: headroom,
  };

  // ── Deferral test ──
  const valueShortfall = Math.max(0, netSale - price);
  const debtShortfall = Math.max(0, debtOff - loan);
  const debtShortfallAfterCash = Math.max(0, debtShortfall - addCash);
  const boot = Math.min(valueShortfall + debtShortfallAfterCash, Math.max(netSale - 0, 0));
  // Boot is taxed at the same blended rate as the gain would have been.
  // Bounded by the deferred amount — you can't owe more than the cash-sale tax.
  const blendedRate = equity > 0 && deferred > 0 ? deferred / equity : 0;
  const taxOnBoot = Math.min(deferred, boot * blendedRate);
  const actuallyDeferred = Math.max(0, deferred - taxOnBoot);

  return {
    replacement_noi: noi,
    replacement_closing_costs: closing,
    cash_required: cashRequired,
    cash_available: cashAvailable,
    cash_surplus: cashSurplus,
    annual_debt_service: ds,
    cash_flow_after_debt: cfads,
    cash_on_cash: coc,
    dscr,
    ltv,
    max_loan_by_ltv: maxByLtv,
    max_loan_by_dscr: maxByDscr,
    max_supportable_loan: maxLoan,
    additional_borrowing_capacity: headroom,
    binding_constraint: binding,
    fully_levered: fullyLevered,
    value_shortfall: valueShortfall,
    debt_shortfall: debtShortfall,
    debt_shortfall_after_cash: debtShortfallAfterCash,
    taxable_boot: boot,
    estimated_tax_on_boot: taxOnBoot,
    tax_actually_deferred: actuallyDeferred,
    fully_deferred: boot <= 0,
    cash_sale_after_tax: equity - deferred,
    exchange_equity_working: cashAvailable,
    equity_advantage: cashAvailable - (equity - deferred + addCash),
  };
}

/** Sensible starting point when the broker hasn't typed anything yet:
 *  buy at the net sale price, replace the debt exactly, 7.5% cap, 2% costs. */
export function defaultReplacementInputs(netSale: number, debtOff: number) {
  return {
    replacement_price: Math.round(netSale / 1000) * 1000,
    replacement_cap_rate: 0.075,
    replacement_loan_amount: Math.round(debtOff / 1000) * 1000,
    replacement_loan_rate: 0.0675,
    replacement_loan_amort_years: 25,
    replacement_closing_cost_pct: 0.02,
    additional_cash: 0,
    max_ltv: 0.65,
    min_dscr: 1.25,
  };
}

// ── Persistence helpers (shared by POST + PATCH) ────────────────────────────

export const XCH_INPUT_COLUMNS = [
  "xch_replacement_price",
  "xch_cap_rate",
  "xch_loan_amount",
  "xch_loan_rate",
  "xch_loan_amort_years",
  "xch_closing_cost_pct",
  "xch_additional_cash",
  "xch_max_ltv",
  "xch_min_dscr",
] as const;

/**
 * Derive the relinquished-side figures from the seller-net inputs. The
 * mortgage payoff is whichever debit line item is labeled like a mortgage
 * — it's the debt to replace, not a transaction cost, so it's pulled OUT
 * of the net-sale-price figure and treated separately.
 */
export function relinquishedFromSellerNet(args: {
  offer_price: number;
  commission: number;
  line_items: { label: string; amount: number; sign: "credit" | "debit" }[];
}): { net_sale_price: number; debt_paid_off: number; equity_available: number } {
  const isMortgage = (l: string) => /mortgage|loan payoff|note payoff/i.test(l);
  let debt = 0;
  let otherAdj = 0;
  for (const li of args.line_items ?? []) {
    const v = num(li.amount);
    if (li.sign === "debit" && isMortgage(li.label ?? "")) debt += v;
    else otherAdj += li.sign === "debit" ? -v : v;
  }
  const netSale = num(args.offer_price) - num(args.commission) + otherAdj;
  return { net_sale_price: netSale, debt_paid_off: debt, equity_available: netSale - debt };
}

/** Compute the computed_exchange snapshot for a merged row, or null when N/A. */
export function exchangeSnapshotColumn(
  row: {
    tax_intends_1031?: boolean | null;
    xch_replacement_price?: number | string | null;
    xch_cap_rate?: number | string | null;
    xch_loan_amount?: number | string | null;
    xch_loan_rate?: number | string | null;
    xch_loan_amort_years?: number | string | null;
    xch_closing_cost_pct?: number | string | null;
    xch_additional_cash?: number | string | null;
    xch_max_ltv?: number | string | null;
    xch_min_dscr?: number | string | null;
  },
  relinquished: { net_sale_price: number; debt_paid_off: number; equity_available: number },
  taxDeferred: number,
): { computed_exchange: ExchangeProjection | null } {
  if (!row.tax_intends_1031 || !num(row.xch_replacement_price)) return { computed_exchange: null };
  return {
    computed_exchange: computeExchangeProjection({
      relinquished_net_sale_price: relinquished.net_sale_price,
      relinquished_debt_paid_off: relinquished.debt_paid_off,
      equity_available: relinquished.equity_available,
      tax_deferred: taxDeferred,
      replacement_price: num(row.xch_replacement_price),
      replacement_cap_rate: num(row.xch_cap_rate),
      replacement_loan_amount: num(row.xch_loan_amount),
      replacement_loan_rate: num(row.xch_loan_rate),
      replacement_loan_amort_years: num(row.xch_loan_amort_years) || 25,
      replacement_closing_cost_pct: num(row.xch_closing_cost_pct),
      additional_cash: num(row.xch_additional_cash),
      max_ltv: num(row.xch_max_ltv) || 0.65,
      min_dscr: num(row.xch_min_dscr) || 1.25,
    }),
  };
}
