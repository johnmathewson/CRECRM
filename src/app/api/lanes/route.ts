/**
 * Lanes — list + create.
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

export async function GET() {
  const { data, error } = await sb()
    .from("lanes")
    .select("*")
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lanes: data ?? [] });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.name || !body.trigger_type) {
      return NextResponse.json({ error: "name and trigger_type required" }, { status: 400 });
    }
    const { data, error } = await sb()
      .from("lanes")
      .insert({
        organization_id: ORG_ID,
        name: body.name,
        description: body.description ?? null,
        status: body.status ?? "draft",
        trigger_type: body.trigger_type,
        filters: body.filters ?? {},
        cadence: body.cadence ?? [],
        approval_mode: body.approval_mode ?? {
          email: "queue", sms: "queue", call: "manual",
          letter: "auto", voicemail: "manual",
        },
        daily_touch_cap: body.daily_touch_cap ?? 50,
        weekly_enrollment_cap: body.weekly_enrollment_cap ?? 25,
      })
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
