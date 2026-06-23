/**
 * PATCH /api/deals/[id] — update mutable deal fields (price, probability,
 *                          expected close, commission, notes, deal_name,
 *                          client_contact_id).
 *
 * Stage moves use /advance. Won/lost/dead use /close.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

const ALLOWED_FIELDS = [
  "deal_name", "deal_type", "price", "commission_pct", "estimated_commission",
  "probability_pct", "expected_close", "client_contact_id", "notes",
];

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  for (const f of ALLOWED_FIELDS) {
    if (body[f] !== undefined) update[f] = body[f];
  }
  if (Object.keys(update).length <= 1) {
    return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
  }

  const sb = svc();

  // Read current values so we can derive commission fields against the
  // merged state (e.g. broker patches just commission_pct → we still
  // need the existing price to recompute estimated_commission). Single
  // round-trip read; cheaper than letting the values drift.
  const { data: current } = await sb
    .from("deals")
    .select("deal_type, price, commission_pct, estimated_commission, probability_pct")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (current) {
    const merged = {
      deal_type:           update.deal_type            ?? current.deal_type,
      price:               update.price                ?? current.price,
      commission_pct:      update.commission_pct       ?? current.commission_pct,
      estimated_commission: update.estimated_commission ?? current.estimated_commission,
      probability_pct:     update.probability_pct      ?? current.probability_pct,
    };

    // Auto-fill estimated_commission for SALE deals when the broker
    // updated price OR commission_pct but didn't explicitly set
    // estimated_commission in this PATCH.
    const broker_set_est = body.estimated_commission !== undefined;
    if (
      !broker_set_est &&
      merged.deal_type === "sale" &&
      merged.price != null &&
      merged.commission_pct != null
    ) {
      update.estimated_commission = Math.round(
        Number(merged.price) * (Number(merged.commission_pct) / 100)
      );
    }

    // Always recompute weighted_commission from merged values so the
    // rollups can trust this column. Cheap and keeps the data honest.
    const finalEst = update.estimated_commission ?? merged.estimated_commission;
    if (finalEst != null && merged.probability_pct != null) {
      update.weighted_commission = Math.round(
        Number(finalEst) * (Number(merged.probability_pct) / 100) * 100
      ) / 100;
    }
  }

  const { data, error } = await sb
    .from("deals")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deal: data });
}
