/**
 * Token-gated single-offer ops:
 *   PATCH  /api/public/owner/[token]/offers/[offerId]   — update inputs + recompute
 *   DELETE /api/public/owner/[token]/offers/[offerId]   — remove
 *
 * Both verify the offer's property_id is in the token's property_ids array;
 * otherwise the request is rejected even if the offerId is valid.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID } from "@/lib/owner-dashboard";
import { computeSellerNet, type SellerNetInputs } from "@/lib/seller-net";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = [
  "https://stewardshipcre.com",
  "https://www.stewardshipcre.com",
  "http://localhost:3000",
  "http://localhost:3001",
];
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

async function authorize(sb: any, token: string, offerId: string, origin: string | null) {
  const { data: tokenRow } = await sb
    .from("owner_access_tokens")
    .select("id, property_ids, expires_at, revoked_at")
    .eq("token", token)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!tokenRow || tokenRow.revoked_at) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Invalid or revoked link" }, { status: 401, headers: corsHeaders(origin) }),
    };
  }
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Link expired" }, { status: 401, headers: corsHeaders(origin) }),
    };
  }

  const { data: offer } = await sb
    .from("seller_net_offers")
    .select("id, property_id")
    .eq("id", offerId)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!offer) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Offer not found" }, { status: 404, headers: corsHeaders(origin) }),
    };
  }
  if (!(tokenRow.property_ids ?? []).includes(offer.property_id)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders(origin) }),
    };
  }
  return { ok: true as const, offer };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string; offerId: string } }
) {
  const origin = req.headers.get("origin");
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(origin) }); }

  const sb = svc();
  const auth = await authorize(sb, params.token, params.offerId, origin);
  if (!auth.ok) return auth.response;

  // Whitelisted updates
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const f of ["title", "buyer_name", "offer_date", "offer_price",
                   "commission_pct", "commission_amount", "line_items",
                   "partners", "notes"]) {
    if (body[f] !== undefined) update[f] = body[f];
  }

  // Recompute totals if any input field changed
  const recomputeKeys = ["offer_price", "commission_pct", "commission_amount", "line_items", "partners"];
  if (recomputeKeys.some((k) => k in update)) {
    // Pull current row, merge in the patch, then compute.
    const { data: current } = await sb
      .from("seller_net_offers")
      .select("offer_price, commission_pct, commission_amount, line_items, partners")
      .eq("id", params.offerId)
      .single();
    const merged: SellerNetInputs = {
      offer_price: Number(update.offer_price ?? current?.offer_price ?? 0),
      commission_pct: update.commission_pct ?? current?.commission_pct ?? null,
      commission_amount: update.commission_amount ?? current?.commission_amount ?? null,
      line_items: update.line_items ?? current?.line_items ?? [],
      partners: update.partners ?? current?.partners ?? [],
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
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) });
  return NextResponse.json({ offer: data }, { headers: corsHeaders(origin) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { token: string; offerId: string } }
) {
  const origin = req.headers.get("origin");
  const sb = svc();
  const auth = await authorize(sb, params.token, params.offerId, origin);
  if (!auth.ok) return auth.response;

  const { error } = await sb
    .from("seller_net_offers")
    .delete()
    .eq("id", params.offerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) });
  return NextResponse.json({ ok: true }, { headers: corsHeaders(origin) });
}
