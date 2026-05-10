/**
 * Lane enrollment — sweep matching cold prospects into the lane.
 *
 * Respects weekly_enrollment_cap. Skips properties already enrolled in
 * this lane (regardless of status). Sets next_action_at to now() so the
 * cadence runner picks up the first step immediately.
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

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const client = sb();

    const { data: lane, error: laneErr } = await client
      .from("lanes")
      .select("id, status, filters, weekly_enrollment_cap")
      .eq("organization_id", ORG_ID)
      .eq("id", params.id)
      .maybeSingle();
    if (laneErr) return NextResponse.json({ error: laneErr.message }, { status: 500 });
    if (!lane) return NextResponse.json({ error: "Lane not found" }, { status: 404 });

    const filters = (lane.filters as Filters) ?? {};
    const cap = (lane.weekly_enrollment_cap as number) ?? 25;

    // Existing enrollments in this lane (any status — never re-enroll the same property)
    const { data: existing } = await client
      .from("lane_enrollments")
      .select("property_id")
      .eq("organization_id", ORG_ID)
      .eq("lane_id", lane.id);
    const enrolledIds = new Set(((existing ?? []) as Array<{ property_id: string }>).map((e) => e.property_id));

    // Find matching prospects
    let q = client
      .from("properties")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("status", "prospect")
      .order("prospector_score", { ascending: false, nullsFirst: false })
      .limit(cap * 4); // pull extra so we have room after dedupe

    if (filters.asset_types?.length) q = q.in("asset_type", filters.asset_types);
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
    if (filters.required_signal_flags?.length) q = q.contains("prospector_signal_flags", filters.required_signal_flags);
    if (filters.trigger_window_months != null) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() + filters.trigger_window_months);
      q = q.lte("mortgage_maturity_date", cutoff.toISOString().slice(0, 10));
      q = q.gte("mortgage_maturity_date", new Date().toISOString().slice(0, 10));
    }

    const { data: candidates } = await q;
    const toEnroll = ((candidates ?? []) as Array<{ id: string }>)
      .filter((p) => !enrolledIds.has(p.id))
      .slice(0, cap);

    if (toEnroll.length === 0) {
      return NextResponse.json({
        enrolled: 0,
        message: enrolledIds.size > 0
          ? "All currently matching prospects are already enrolled in this lane."
          : "No prospects match the lane's current filters. Try widening the filter or import more data.",
      });
    }

    const now = new Date().toISOString();
    const rows = toEnroll.map((p) => ({
      organization_id: ORG_ID,
      lane_id: lane.id,
      property_id: p.id,
      status: "active",
      current_step: 0,
      next_action_at: now,
    }));

    const { error: insErr } = await client.from("lane_enrollments").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    // Update lane's enrolled counter
    await client
      .from("lanes")
      .update({ total_enrolled: (await getEnrollCount(client, lane.id)) })
      .eq("id", lane.id);

    return NextResponse.json({ enrolled: toEnroll.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

async function getEnrollCount(client: ReturnType<typeof sb>, laneId: string): Promise<number> {
  const { count } = await client
    .from("lane_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("lane_id", laneId);
  return count ?? 0;
}
