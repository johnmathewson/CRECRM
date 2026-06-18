/**
 * GET /api/properties/match?q=<query>&limit=<n>
 *
 * Fuzzy address + name match over the 15k properties in the DB.
 * Powers the "Add Property" autocomplete — so a broker can start
 * typing an address and we suggest existing matches (including the
 * common case of multi-address commercial buildings).
 *
 * Distinct from /api/properties/search (which is ILIKE substring
 * matching for the compose-dialog recipient picker). This one uses
 * pg_trgm similarity and returns confidence scores so the UI can
 * rank visually.
 *
 * Wraps the search_properties() Postgres RPC. The actual ranking +
 * threshold logic lives in the SQL function so it's tunable without
 * redeploying.
 *
 * Response: { matches: PropertyMatch[] } — empty array on no match or
 * short query (<2 chars). Never throws on empty input; the UI relies
 * on a clean empty list when the broker is just starting to type.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export interface PropertyMatch {
  id: string;
  slug: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: string | null;
  asking_price: number | null;
  sqft: number | null;
  status: string | null;
  pipeline_stage: string | null;
  match_score: number; // 0..1.05 (slight boost for name matches)
  match_field: "address" | "name";
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") ?? "7", 10), 1), 25);

  // Short queries return empty — trigram similarity on 1-2 chars is
  // noise. Two chars is also a common UX threshold for autocomplete.
  if (q.length < 2) {
    return NextResponse.json({ matches: [] });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.rpc("search_properties", {
    search_query: q,
    match_limit: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ matches: (data ?? []) as PropertyMatch[] });
}
