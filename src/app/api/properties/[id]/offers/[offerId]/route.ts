/**
 * PATCH  /api/properties/[id]/offers/[offerId]  — update inputs + recompute
 * DELETE /api/properties/[id]/offers/[offerId]  — remove
 *
 * Internal admin paths — sees both drafts and published offers. The token-
 * gated public counterparts at /api/public/owner/[token]/offers/[offerId]
 * filter to published-only and verify token access.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeSellerNet, type SellerNetInputs } from "@/lib/seller-net";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; offerId: string } }
) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const sb = svc();
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const f of ["title", "buyer_name", "offer_date", "offer_price",
                   "commission_pct", "commission_amount", "line_items",
                   "partners", "notes"]) {
    if (body[f] !== undefined) update[f] = body[f];
  }

  // Recompute when inputs change
  const recomputeKeys = ["offer_price", "commission_pct", "commission_amount", "line_items", "partners"];
  if (recomputeKeys.some((k) => k in update)) {
    const { data: current } = await sb
      .from("seller_net_offers")
      .select("offer_price, commission_pct, commission_amount, line_items, partners")
      .eq("id", params.offerId)
      .eq("property_id", params.id)
      .eq("organization_id", ORG_ID)
      .single();
    if (!current) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    const merged: SellerNetInputs = {
      offer_price: Number(update.offer_price ?? current.offer_price ?? 0),
      commission_pct: update.commission_pct ?? current.commission_pct ?? null,
      commission_amount: update.commission_amount ?? current.commission_amount ?? null,
      line_items: update.line_items ?? current.line_items ?? [],
      partners: update.partners ?? current.partners ?? [],
    };
    const totals = computeSellerNet(merged);
    update.computed_commission = totals.commission;
    update.computed_adjustments = totals.adjustments;
    update.computed_net_proceeds = totals.net_proceeds;
    update.computed_partners_due = totals.partners_due;
    update.computed_net_after_partners = totals.net_after_partners;
  }

  const { data, error } = await sb
    .from("seller_net_offers")
    .update(update)
    .eq("id", params.offerId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offer: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; offerId: string } }
) {
  const sb = svc();
  const { error } = await sb
    .from("seller_net_offers")
    .delete()
    .eq("id", params.offerId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
