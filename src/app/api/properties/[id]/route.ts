/**
 * GET   /api/properties/[id]  — full row
 * PATCH /api/properties/[id]  — partial update (any column on properties)
 *
 * Used by the Edit Listing modal and the "Publish to Website" toggle.
 * Slug is regenerated from address+city only when address or city changes
 * AND no slug was supplied — preserves existing public URLs by default.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// Whitelist of columns the API will let you patch. Keeps random keys from
// landing in the DB and prevents accidental ID/org swaps.
const PATCHABLE_FIELDS = new Set([
  "name", "headline", "address", "city", "state", "zip",
  "asset_type", "transaction_type", "status", "your_role",
  "asking_price", "lease_rate", "sqft", "acreage", "year_built",
  "parking_spaces", "parking_ratio", "zoning",
  "noi", "cap_rate", "price_per_sf", "occupancy_pct",
  "description", "highlights", "notes", "crexi_url",
  "publish_to_website", "crexi_sync_status", "source_import",
  "headline", "images", "slug",
]);

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = svc();
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ property: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE_FIELDS.has(k)) update[k] = v;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const supabase = svc();
  const { data, error } = await supabase
    .from("properties")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ property: data });
}
