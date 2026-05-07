import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { computeSellerNet, type SellerNetInputs } from "@/lib/seller-net";
import { OfferPrintView } from "./OfferPrintView";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export const dynamic = "force-dynamic";

/**
 * Branded seller-net summary, print-optimized. The "Download PDF" button on
 * the property workspace's Offers tab opens this in a new tab; an auto-
 * print effect fires `window.print()` on load so the user just hits "Save
 * as PDF" in the system print dialog.
 *
 * Server-renders so the page is fully populated before the print fires —
 * no flicker, no missing data. The layout is a single page (Letter size)
 * with Stewardship CRE branding and the full numeric breakdown.
 */
export default async function OfferPrintPage({
  params,
}: {
  params: { slug: string; offerId: string };
}) {
  const sb = createServerSupabase();

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

  return <OfferPrintView property={property} offer={offer} inputs={inputs} totals={totals} />;
}
