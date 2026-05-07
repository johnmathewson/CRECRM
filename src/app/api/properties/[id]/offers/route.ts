/**
 * GET  /api/properties/[id]/offers   — list ALL offers (drafts + published) for a property
 * POST /api/properties/[id]/offers   — create a new offer (defaults to DRAFT)
 *
 * Internal admin counterpart to the token-gated /api/public/owner/[token]/offers
 * endpoints. The CRE OS Property workspace's "Offers" tab uses these so the
 * broker can iterate on a scenario internally before publishing it to the
 * owner's portal.
 *
 * Body for POST: same shape as the public version, plus:
 *   • published?: boolean — default false (draft). Pass `true` to skip the
 *     draft step and publish immediately.
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = svc();
  const { data, error } = await sb
    .from("seller_net_offers")
    .select(
      "id, property_id, title, buyer_name, offer_date, offer_price, commission_pct, commission_amount, line_items, partners, computed_commission, computed_adjustments, computed_net_proceeds, computed_partners_due, computed_net_after_partners, notes, published_at, created_at, updated_at, created_via_token_id"
    )
    .eq("organization_id", ORG_ID)
    .eq("property_id", params.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offers: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (body.offer_price === undefined || body.offer_price === null || Number.isNaN(Number(body.offer_price))) {
    return NextResponse.json({ error: "offer_price is required" }, { status: 400 });
  }

  // Confirm property belongs to org
  const sb = svc();
  const { data: prop } = await sb
    .from("properties")
    .select("id")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!prop) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  const inputs: SellerNetInputs = {
    offer_price: Number(body.offer_price),
    commission_pct: body.commission_pct ?? null,
    commission_amount: body.commission_amount ?? null,
    line_items: Array.isArray(body.line_items) ? body.line_items : [],
    partners: Array.isArray(body.partners) ? body.partners : [],
  };
  const totals = computeSellerNet(inputs);

  const insertPayload: Record<string, any> = {
    organization_id: ORG_ID,
    property_id: params.id,
    // Internal-created offers default to DRAFT. Caller can opt-in to publish
    // on create with { published: true }.
    published_at: body.published === true ? new Date().toISOString() : null,
    title: body.title.trim(),
    buyer_name: body.buyer_name?.trim() || null,
    offer_date: body.offer_date || null,
    offer_price: inputs.offer_price,
    commission_pct: inputs.commission_pct,
    commission_amount: inputs.commission_amount,
    line_items: inputs.line_items,
    partners: inputs.partners,
    computed_commission: totals.commission,
    computed_adjustments: totals.adjustments,
    computed_net_proceeds: totals.net_proceeds,
    computed_partners_due: totals.partners_due,
    computed_net_after_partners: totals.net_after_partners,
    notes: body.notes?.trim() || null,
  };

  const { data, error } = await sb
    .from("seller_net_offers")
    .insert(insertPayload)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offer: data }, { status: 201 });
}
