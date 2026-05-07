import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { computeSellerNet, type SellerNetInputs } from "@/lib/seller-net";
import { OfferPrintView } from "./OfferPrintView";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export const dynamic = "force-dynamic";

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

  return <OfferPrintView property={property} offer={offer} inputs={inputs} totals={totals} />;
}
