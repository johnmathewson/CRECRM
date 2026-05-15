/**
 * Lane — get / update / delete.
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

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await sb()
    .from("lanes")
    .select("*")
    .eq("organization_id", ORG_ID)
    .eq("id", params.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ lane: data });
}

const UPDATABLE = [
  "name", "description", "status", "trigger_type", "filters", "cadence",
  "approval_mode", "daily_touch_cap", "weekly_enrollment_cap",
  // The persona that drives AI drafts for this lane. NULL is valid (falls
  // back to slug-by-trigger-type lookup in the personalizer).
  "persona_id",
];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = {};
    for (const k of UPDATABLE) if (k in body) patch[k] = body[k];
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
    }
    const { data, error } = await sb()
      .from("lanes")
      .update(patch)
      .eq("organization_id", ORG_ID)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ lane: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await sb()
    .from("lanes")
    .delete()
    .eq("organization_id", ORG_ID)
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
