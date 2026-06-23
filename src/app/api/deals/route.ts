/**
 * POST /api/deals — create a deal directly (without going through a lead).
 *
 * Used by:
 *   • Pipeline view "+ Add Deal" (standalone pursuit)
 *   • Property workspace "Convert to deal" (property-anchored)
 *   • Internal callers that need a fresh deal
 *
 * Body: { property_id?, client_contact_id?, deal_type ('sale'|'lease'|'buyer_rep'),
 *         deal_name?, price?, probability_pct?, expected_close?,
 *         initial_stage? (default 'Lead'), notes? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeStage, type StageKey } from "@/lib/cre-os/stage-config";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.property_id && !body.client_contact_id) {
    return NextResponse.json(
      { error: "Either property_id or client_contact_id is required" },
      { status: 400 }
    );
  }

  const dealType: "sale" | "lease" | "buyer_rep" =
    ["sale", "lease", "buyer_rep"].includes(body.deal_type) ? body.deal_type : "sale";

  const sb = svc();

  // Pull defaults from property/contact when present so deal name isn't empty.
  let propertyName: string | null = null;
  if (body.property_id) {
    const { data } = await sb
      .from("properties")
      .select("name, headline, asking_price, lease_rate")
      .eq("id", body.property_id)
      .maybeSingle();
    if (data) {
      propertyName = data.headline || data.name || null;
      if (body.price === undefined || body.price === null) {
        body.price = dealType === "sale" ? data.asking_price : data.lease_rate;
      }
    }
  }
  let contactName: string | null = null;
  if (body.client_contact_id) {
    const { data } = await sb
      .from("contacts")
      .select("full_name")
      .eq("id", body.client_contact_id)
      .maybeSingle();
    contactName = data?.full_name ?? null;
  }
  const dealName =
    body.deal_name?.trim() ||
    (propertyName && contactName
      ? `${propertyName} — ${contactName}`
      : propertyName || contactName || "New deal");

  const insertPayload: Record<string, any> = {
    organization_id: ORG_ID,
    deal_type: dealType,
    deal_name: dealName,
    assigned_to: USER_ID,
    probability_pct: body.probability_pct ?? 25,
  };
  for (const f of ["property_id", "client_contact_id", "price", "commission_pct",
                   "estimated_commission", "expected_close", "notes"]) {
    if (body[f] !== undefined && body[f] !== null && body[f] !== "") {
      insertPayload[f] = body[f];
    }
  }

  // Auto-derive commission fields so the pipeline rollups stay correct
  // without depending on the broker to do the math. Both columns are
  // pct expressed 0-100 (e.g. 5 = 5%, NOT 0.05).
  //   - estimated_commission = price × (commission_pct / 100) when both
  //     are set on a SALE deal AND the broker didn't pass an override.
  //     Lease deals skip this — lease commission usually comes from
  //     total lease value (term × annual rent × pct), not the price
  //     column (which on lease deals stores rate $/SF/yr).
  //   - weighted_commission = estimated × (probability / 100).
  if (
    dealType === "sale" &&
    insertPayload.estimated_commission === undefined &&
    insertPayload.price != null &&
    insertPayload.commission_pct != null
  ) {
    insertPayload.estimated_commission = Math.round(
      Number(insertPayload.price) * (Number(insertPayload.commission_pct) / 100)
    );
  }
  if (
    insertPayload.estimated_commission != null &&
    insertPayload.probability_pct != null
  ) {
    insertPayload.weighted_commission = Math.round(
      Number(insertPayload.estimated_commission) *
        (Number(insertPayload.probability_pct) / 100) *
        100
    ) / 100;
  }

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .insert(insertPayload)
    .select()
    .single();

  if (dealErr || !deal) {
    return NextResponse.json({ error: dealErr?.message || "Insert failed" }, { status: 500 });
  }

  const initialStage: StageKey = normalizeStage(body.initial_stage);
  await sb.from("deal_stages").insert({
    deal_id: deal.id,
    stage: initialStage,
    entered_at: new Date().toISOString(),
    entered_by: USER_ID,
    notes: "Deal created",
  });

  return NextResponse.json({ deal }, { status: 201 });
}
