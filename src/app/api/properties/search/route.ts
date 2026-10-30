/**
 * GET /api/properties/search?q=&limit=20&status=&working_first=1
 *
 * Lightweight property search for dialog autocomplete. Returns minimal
 * fields suitable for picking a property quickly.
 *
 * The table holds ~15k properties, nearly all `prospect` rows from data
 * imports, so pickers must search server-side — a preloaded list gets cut
 * at PostgREST's 1,000-row cap and silently drops real properties.
 * `working_first=1` puts the broker's own (non-prospect) properties ahead
 * of prospect matches.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const FIELDS = "id, slug, name, headline, address, city, state, owner_name_raw, asset_type, status";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // Commas, parentheses and wildcards would break (or widen) the PostgREST
  // `or` filter below, so keep only the text a person would search for.
  const q = (searchParams.get("q") ?? "").replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20") || 20, 50);
  const status = searchParams.get("status");
  const workingFirst = searchParams.get("working_first") === "1";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  function base(scope: "all" | "working" | "prospect") {
    let query = supabase
      .from("properties")
      .select(FIELDS)
      .eq("organization_id", ORG_ID)
      .order(scope === "working" ? "updated_at" : "created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (scope === "working") query = query.or("status.is.null,status.neq.prospect");
    if (scope === "prospect") query = query.eq("status", "prospect");
    if (q) {
      query = query.or(
        `name.ilike.%${q}%,headline.ilike.%${q}%,address.ilike.%${q}%,city.ilike.%${q}%,owner_name_raw.ilike.%${q}%`
      );
    }
    return query;
  }

  if (!workingFirst || status) {
    const { data, error } = await base("all");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ properties: data ?? [] });
  }

  const [working, prospects] = await Promise.all([
    base("working"),
    q ? base("prospect") : Promise.resolve({ data: [], error: null }),
  ]);
  const error = working.error || prospects.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const properties = [...(working.data ?? []), ...(prospects.data ?? [])].slice(0, limit);
  return NextResponse.json({ properties });
}
