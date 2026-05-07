/**
 * POST   /api/properties/[id]/offers/[offerId]/publish    — publish (or republish)
 * DELETE /api/properties/[id]/offers/[offerId]/publish    — unpublish (back to draft)
 *
 * Toggles `published_at` on a seller-net offer. Owner-portal endpoints filter
 * to published-only, so this is the gate between internal scratch work and
 * what the seller sees.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; offerId: string } }
) {
  const sb = svc();
  const { data, error } = await sb
    .from("seller_net_offers")
    .update({ published_at: new Date().toISOString() })
    .eq("id", params.offerId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .select("id, published_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offer: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; offerId: string } }
) {
  const sb = svc();
  const { data, error } = await sb
    .from("seller_net_offers")
    .update({ published_at: null })
    .eq("id", params.offerId)
    .eq("property_id", params.id)
    .eq("organization_id", ORG_ID)
    .select("id, published_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ offer: data });
}
