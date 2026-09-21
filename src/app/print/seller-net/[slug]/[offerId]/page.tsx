import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { computeSellerNet, type SellerNetInputs } from "@/lib/seller-net";
import { computeSellerTaxEstimate, type SellerTaxEstimate } from "@/lib/seller-tax-estimate";
import { computeExchangeProjection, relinquishedFromSellerNet, type ExchangeProjection } from "@/lib/exchange-rollover";
import { OfferPrintView } from "./OfferPrintView";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export const dynamic = "force-dynamic";
// Belt-and-suspenders no-cache: dynamic = "force-dynamic" should be enough
// but noStore() opts out of every caching layer Next.js exposes, so the
// PDF route can't possibly serve stale data after the broker just saved.

/**
 * Branded seller-net summary, print-optimized.
 *
 * Lives at /print/seller-net/[slug]/[offerId] (NOT under /cre-os/) so it
 * doesn't inherit the app shell's viewport-locked layout — the page
 * scrolls naturally on the body and the broker can preview before
 * saving as PDF.
 *
 * Uses the anon-key Supabase client because the seller_net_offers RLS
 * policies are TO anon. With the cookie session the queries would run
 * as `authenticated`, which has no policies on those tables.
 *
 * Public by URL — middleware exempts /print/*. Same security model as
 * the magic-link portals: the URL embeds opaque IDs (property slug +
 * offer UUID) and the page only surfaces data scoped to those IDs.
 */
export default async function OfferPrintPage({
  params,
}: {
  params: { slug: string; offerId: string };
}) {
  noStore();
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: property } = await sb
    .from("properties")
    .select("id, name, headline, address, city, state, zip, asset_type, transaction_type, asking_price, sqft")
    .eq("organization_id", ORG_ID)
    .eq("slug", params.slug)
    .maybeSingle();
  if (!property) notFound();

  const { data: offer } = await sb
    .from("seller_net_offers")
    .select("*")
    .eq("organization_id", ORG_ID)
    .eq("id", params.offerId)
    .eq("property_id", property.id)
    .maybeSingle();
  if (!offer) notFound();

  const inputs: SellerNetInputs = {
    offer_price: Number(offer.offer_price),
    commission_pct: offer.commission_pct,
    commission_amount: offer.commission_amount,
    line_items: offer.line_items ?? [],
    partners: offer.partners ?? [],
  };
  const totals = computeSellerNet(inputs);

  // Tier-1 seller tax estimate — recomputed live from the stored inputs so
  // the PDF always reflects current rate assumptions, not a stale snapshot.
  const tax: SellerTaxEstimate | null = offer.tax_original_purchase_price
    ? computeSellerTaxEstimate({
        net_proceeds: totals.net_proceeds,
        original_purchase_price: Number(offer.tax_original_purchase_price),
        purchase_date: offer.tax_purchase_date ?? null,
        capital_improvements: Number(offer.tax_capital_improvements ?? 0),
        accumulated_depreciation:
          offer.tax_accumulated_depreciation == null ? null : Number(offer.tax_accumulated_depreciation),
        sale_date: offer.offer_date ?? null,
        intends_1031: !!offer.tax_intends_1031,
      })
    : null;

  const relinquished = relinquishedFromSellerNet({
    offer_price: inputs.offer_price,
    commission: totals.commission,
    line_items: inputs.line_items,
  });
  const exchange: ExchangeProjection | null =
    tax && offer.tax_intends_1031 && offer.xch_replacement_price
      ? computeExchangeProjection({
          relinquished_net_sale_price: relinquished.net_sale_price,
          relinquished_debt_paid_off: relinquished.debt_paid_off,
          equity_available: relinquished.equity_available,
          tax_deferred: tax.tax_deferred_via_1031,
          replacement_price: Number(offer.xch_replacement_price),
          replacement_cap_rate: Number(offer.xch_cap_rate ?? 0),
          replacement_loan_amount: Number(offer.xch_loan_amount ?? 0),
          replacement_loan_rate: Number(offer.xch_loan_rate ?? 0),
          replacement_loan_amort_years: Number(offer.xch_loan_amort_years ?? 25),
          replacement_closing_cost_pct: Number(offer.xch_closing_cost_pct ?? 0),
          additional_cash: Number(offer.xch_additional_cash ?? 0),
          max_ltv: Number(offer.xch_max_ltv ?? 0) || 0.65,
          min_dscr: Number(offer.xch_min_dscr ?? 0) || 1.25,
        })
      : null;

  return <OfferPrintView property={property} offer={offer} inputs={inputs} totals={totals} tax={tax} exchange={exchange} />;
}
