/**
 * GET /api/properties/search?q=&limit=20&status=
 *
 * Lightweight property search for compose-dialog autocomplete. Returns
 * minimal fields suitable for picking a recipient quickly.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20") || 20, 50);
  const status = searchParams.get("status");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  let query = supabase
    .from("properties")
    .select("id, slug, name, address, city, state, owner_name_raw, asset_type, status")
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);
  if (q) {
    query = query.or(
      `name.ilike.%${q}%,address.ilike.%${q}%,city.ilike.%${q}%,owner_name_raw.ilike.%${q}%`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ properties: data ?? [] });
}
