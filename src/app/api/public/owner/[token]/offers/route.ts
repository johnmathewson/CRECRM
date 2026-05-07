/**
 * Token-gated CRUD for seller-net offer scenarios.
 *
 *   GET  /api/public/owner/[token]/offers
 *        → all offers across the properties this token can see
 *
 *   POST /api/public/owner/[token]/offers
 *        → create a new offer scenario. Body must include property_id that
 *          is in the token's property_ids array (or the request is rejected).
 *
 * Single-offer GET / PATCH / DELETE live in [offerId]/route.ts.
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

/** Common token-validation helper. Returns the row + property_ids or an
 *  error response that callers can short-circuit on. */
async function resolveToken(sb: any, token: string, origin: string | null) {
  const { data: row } = await sb
    .from("owner_access_tokens")
    .select("id, property_ids, expires_at, revoked_at")
    .eq("token", token)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!row || row.revoked_at) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Invalid or revoked link" },
        { status: 401, headers: corsHeaders(origin) }
      ),
    };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Link expired" },
        { status: 401, headers: corsHeaders(origin) }
      ),
    };
  }
  return { ok: true as const, token: row };
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const origin = req.headers.get("origin");
  const sb = svc();
  const auth = await resolveToken(sb, params.token, origin);
  if (!auth.ok) return auth.response;

  const propertyIds = auth.token.property_ids ?? [];
  if (propertyIds.length === 0) {
    return NextResponse.json({ offers: [] }, { headers: corsHeaders(origin) });
  }

  const { data, error } = await sb
    .from("seller_net_offers")
    .select(
      "id, property_id, title, buyer_name, offer_date, offer_price, commission_pct, commission_amount, line_items, partners, computed_commission, computed_adjustments, computed_net_proceeds, computed_partners_due, computed_net_after_partners, notes, created_at, updated_at"
    )
    .eq("organization_id", ORG_ID)
    .in("property_id", propertyIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) });
  }
  return NextResponse.json({ offers: data ?? [] }, { headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const origin = req.headers.get("origin");
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(origin) });
  }

  const sb = svc();
  const auth = await resolveToken(sb, params.token, origin);
  if (!auth.ok) return auth.response;

  const propertyIds = auth.token.property_ids ?? [];
  if (!body.property_id || !propertyIds.includes(body.property_id)) {
    return NextResponse.json(
      { error: "property_id is required and must be one this token can access" },
      { status: 403, headers: corsHeaders(origin) }
    );
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400, headers: corsHeaders(origin) });
  }
  if (body.offer_price === undefined || body.offer_price === null || Number.isNaN(Number(body.offer_price))) {
    return NextResponse.json({ error: "offer_price is required" }, { status: 400, headers: corsHeaders(origin) });
  }

  // Compute snapshot totals server-side so the list view doesn't have to
  // re-derive them. The client also computes for live preview.
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
    property_id: body.property_id,
    created_via_token_id: auth.token.id,
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

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders(origin) });
  }
  return NextResponse.json({ offer: data }, { status: 201, headers: corsHeaders(origin) });
}
