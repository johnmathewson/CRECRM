/**
 * Seller-net offer-analysis math. Used by:
 *   • The owner-portal calculator (live preview while typing)
 *   • The CRM API (snapshot computed totals into seller_net_offers row)
 *
 * Everything here is pure — no DB, no fetch — so it can be imported into
 * the marketing-site repo verbatim or duplicated as needed.
 */

export type LineItemSign = "credit" | "debit";

export interface SellerNetLineItem {
  /** Human label, e.g. "Tax prorations". */
  label: string;
  /** Dollar amount, always positive — direction is captured by `sign`. */
  amount: number;
  /** credit = adds to seller proceeds; debit = reduces them. */
  sign: LineItemSign;
}

export interface SellerNetPartner {
  /** Display name, e.g. "Mike — Anchor LP". */
  name: string;
  /** Capital contributed (will be returned 1:1 from net proceeds). */
  capital: number;
  /** Annual preferred return rate, percent (e.g. 10 = 10%/yr). */
  pref_pct: number;
  /** Hold period in years — multiplies pref_pct to get total preferred return. */
  hold_years: number;
  /**
   * Ownership of the residual (after capital + pref are paid back), in %.
   * If all partners' percents sum to <100, the remainder is implicit
   * sponsor / common-equity stake.
   */
  ownership_pct: number;
}

export interface SellerNetInputs {
  offer_price: number;
  /** If both pct and amount are provided, amount wins. */
  commission_pct: number | null;
  commission_amount: number | null;
  line_items: SellerNetLineItem[];
  partners: SellerNetPartner[];
}

export interface SellerNetTotals {
  commission: number;
  /** Net of credits/debits across all line_items (positive = adds to seller). */
  adjustments: number;
  /** offer_price - commission + adjustments */
  net_proceeds: number;
  /** Sum of capital + preferred-return owed across all partners. */
  partners_due: number;
  /** net_proceeds - partners_due */
  net_after_partners: number;
  /** Per-partner breakdown for distribution display. */
  partner_breakdown: Array<{
    name: string;
    capital: number;
    preferred_return: number;
    /** Capital + preferred return — the "owed" portion. */
    owed: number;
    /** Their slice of the residual (after partners_due is paid). */
    residual_share: number;
    /** Total distribution to this partner = owed + residual_share. */
    total_distribution: number;
  }>;
  /** Residual that goes to sponsor / common (sum of unallocated ownership %). */
  sponsor_residual: number;
}

const num = (v: any): number => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export function computeSellerNet(inputs: SellerNetInputs): SellerNetTotals {
  const offer = num(inputs.offer_price);
  const commission =
    inputs.commission_amount !== null && inputs.commission_amount !== undefined
      ? num(inputs.commission_amount)
      : (offer * num(inputs.commission_pct)) / 100;

  const adjustments = (inputs.line_items ?? []).reduce((sum, li) => {
    const v = num(li.amount);
    return sum + (li.sign === "debit" ? -v : v);
  }, 0);

  const net_proceeds = offer - commission + adjustments;

  const partners = inputs.partners ?? [];
  const breakdown = partners.map((p) => {
    const capital = num(p.capital);
    const preferred_return = capital * (num(p.pref_pct) / 100) * num(p.hold_years);
    return {
      name: p.name || "Partner",
      capital,
      preferred_return,
      owed: capital + preferred_return,
      ownership_pct: num(p.ownership_pct),
    };
  });

  const partners_due = breakdown.reduce((s, p) => s + p.owed, 0);
  const net_after_partners = net_proceeds - partners_due;

  const totalOwnership = breakdown.reduce((s, p) => s + p.ownership_pct, 0);
  const sponsorPct = Math.max(0, 100 - totalOwnership);

  // Residual is what's left after capital + pref. It splits by ownership_pct.
  const partner_breakdown = breakdown.map((p) => {
    const residual_share = (net_after_partners * p.ownership_pct) / 100;
    return {
      name: p.name,
      capital: p.capital,
      preferred_return: p.preferred_return,
      owed: p.owed,
      residual_share,
      total_distribution: p.owed + residual_share,
    };
  });

  const sponsor_residual = (net_after_partners * sponsorPct) / 100;

  return {
    commission,
    adjustments,
    net_proceeds,
    partners_due,
    net_after_partners,
    partner_breakdown,
    sponsor_residual,
  };
}
