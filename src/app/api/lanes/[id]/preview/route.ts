/**
 * Lane preview — return count + sample of cold properties that match the
 * lane's filters. Used by the lane configurator to show "47 properties
 * match" before the user activates the lane.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface Filters {
  asset_types?: string[];
  sub_types?: string[];
  counties?: string[];
  states?: string[];
  sqft_min?: number | null;
  sqft_max?: number | null;
  value_min?: number | null;
  value_max?: number | null;
  units_min?: number | null;
  units_max?: number | null;
  year_built_min?: number | null;
  year_built_max?: number | null;
  owner_types?: string[];
  min_years_owned?: number | null;
  trigger_window_months?: number | null;
  required_signal_flags?: string[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function applyFilters(q: any, filters: Filters): any {
  if (filters.asset_types?.length) q = q.in("asset_type", filters.asset_types);
  if (filters.sub_types?.length) q = q.in("sub_type", filters.sub_types);
  if (filters.counties?.length) q = q.in("county", filters.counties);
  if (filters.states?.length) q = q.in("state", filters.states);
  if (filters.sqft_min != null) q = q.gte("sqft", filters.sqft_min);
  if (filters.sqft_max != null) q = q.lte("sqft", filters.sqft_max);
  if (filters.value_min != null) q = q.gte("estimated_value", filters.value_min);
  if (filters.value_max != null) q = q.lte("estimated_value", filters.value_max);
  if (filters.units_min != null) q = q.gte("units", filters.units_min);
  if (filters.units_max != null) q = q.lte("units", filters.units_max);
  if (filters.year_built_min != null) q = q.gte("year_built", filters.year_built_min);
  if (filters.year_built_max != null) q = q.lte("year_built", filters.year_built_max);
  if (filters.owner_types?.length) q = q.in("owner_type", filters.owner_types);
  if (filters.min_years_owned != null) q = q.gte("years_owned", filters.min_years_owned);
  if (filters.required_signal_flags?.length)
    q = q.contains("prospector_signal_flags", filters.required_signal_flags);
  if (filters.trigger_window_months != null) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() + filters.trigger_window_months);
    q = q.lte("mortgage_maturity_date", cutoff.toISOString().slice(0, 10));
    q = q.gte("mortgage_maturity_date", new Date().toISOString().slice(0, 10));
  }
  return q;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    let filters: Filters = body.filters;
    if (!filters) {
      const { data: lane } = await sb()
        .from("lanes")
        .select("filters")
        .eq("organization_id", ORG_ID)
        .eq("id", params.id)
        .maybeSingle();
      filters = ((lane?.filters as Filters) ?? {}) as Filters;
    }

    const countBase = sb()
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .eq("status", "prospect");
    const { count } = await applyFilters(countBase, filters);

    const sampleBase = sb()
      .from("properties")
      .select("id, slug, name, address, city, state, county, asset_type, sub_type, sqft, units, estimated_value, owner_name_raw, prospector_signal_flags, prospector_score")
      .eq("organization_id", ORG_ID)
      .eq("status", "prospect");
    const { data: sample } = await applyFilters(sampleBase, filters)
      .order("prospector_score", { ascending: false, nullsFirst: false })
      .limit(10);

    return NextResponse.json({ count: count ?? 0, sample: sample ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
