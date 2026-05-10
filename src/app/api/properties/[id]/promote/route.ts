/**
 * Promote prospect → warm property.
 *
 * One-way door (with a backstop demote escape hatch). Flips status from
 * 'prospect' to 'prospecting', exits any active lane enrollments with
 * exit_reason='promoted', and writes an activity-log entry on the
 * property timeline so the workspace shows when it crossed over.
 *
 * Optional body: { laneEnrollmentId, note }
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const note = (body?.note as string) ?? null;
    const client = sb();

    const { data: prop, error } = await client
      .from("properties")
      .select("id, status, name")
      .eq("organization_id", ORG_ID)
      .eq("id", params.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!prop) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    if (prop.status !== "prospect") {
      return NextResponse.json({
        error: `Property is already warm (status=${prop.status}). No promotion needed.`,
      }, { status: 400 });
    }

    const now = new Date().toISOString();

    // 1. Flip status
    const { error: upErr } = await client
      .from("properties")
      .update({ status: "prospecting", updated_at: now })
      .eq("id", prop.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // 2. Exit any active enrollments
    await client
      .from("lane_enrollments")
      .update({
        status: "promoted",
        exited_at: now,
        exit_reason: note ?? "Promoted to warm pipeline",
      })
      .eq("organization_id", ORG_ID)
      .eq("property_id", prop.id)
      .in("status", ["active", "engaged", "paused"]);

    // 3. Activity log entry on the property timeline
    await client.from("activities").insert({
      organization_id: ORG_ID,
      activity_type: "note",
      subject: "Promoted from Prospector to warm pipeline",
      body: note ?? "Cold prospect engaged and was promoted into the active pipeline.",
      occurred_at: now,
      property_id: prop.id,
    });

    return NextResponse.json({
      ok: true,
      propertyId: prop.id,
      status: "prospecting",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
