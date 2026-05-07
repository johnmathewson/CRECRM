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
