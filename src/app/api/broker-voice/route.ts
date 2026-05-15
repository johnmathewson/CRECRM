/**
 * PUT /api/broker-voice  — upsert the single broker_voice_profile row for the org
 * GET /api/broker-voice  — fetch current
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await sb
    .from("broker_voice_profile")
    .select("*")
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  return NextResponse.json({ voice: data ?? null });
}

export async function PUT(req: NextRequest) {
  let body: {
    bio?: string | null;
    brand_voice?: string | null;
    pet_phrases?: string[];
    banned_phrases?: string[];
    always_do?: string[];
    never_do?: string[];
    sign_off_default?: string | null;
    physical_address?: string | null;
    unsubscribe_email?: string | null;
    daily_send_cap?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Try update first (single row exists from migration seed)
  const { data: existing } = await sb
    .from("broker_voice_profile")
    .select("id")
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  const payload = {
    organization_id: ORG_ID,
    bio: body.bio ?? null,
    brand_voice: body.brand_voice ?? null,
    pet_phrases: body.pet_phrases ?? [],
    banned_phrases: body.banned_phrases ?? [],
    always_do: body.always_do ?? [],
    never_do: body.never_do ?? [],
    sign_off_default: body.sign_off_default ?? null,
    physical_address: body.physical_address ?? null,
    unsubscribe_email: body.unsubscribe_email ?? null,
    daily_send_cap: body.daily_send_cap ?? 100,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await sb
      .from("broker_voice_profile")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, voice: data });
  }

  // First-time insert (shouldn't normally happen — seeded by migration)
  const { data, error } = await sb
    .from("broker_voice_profile")
    .insert(payload)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, voice: data });
}
