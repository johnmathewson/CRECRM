/**
 * PUT  /api/personas/[slug]   — save edits to a persona
 * GET  /api/personas/[slug]   — fetch current persona (for client refresh)
 *
 * The Prospector reads personas from this table on every AI draft, so a
 * successful PUT here is "live" instantly — the very next draft uses the
 * edited content.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await sb
    .from("personas")
    .select("*")
    .eq("organization_id", ORG_ID)
    .eq("slug", params.slug)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ persona: data });
}

export async function PUT(req: NextRequest, { params }: { params: { slug: string } }) {
  let body: {
    name?: string;
    description?: string | null;
    angle_prompt?: string;
    voice_profile?: Record<string, unknown>;
    skill_profile?: Record<string, unknown>;
    is_active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.angle_prompt !== undefined && (!body.angle_prompt || body.angle_prompt.trim().length === 0)) {
    return NextResponse.json({ error: "angle_prompt cannot be empty" }, { status: 400 });
  }
  if (body.name !== undefined && (!body.name || body.name.trim().length === 0)) {
    return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Build the update payload — only include fields the caller actually sent
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.angle_prompt !== undefined) patch.angle_prompt = body.angle_prompt;
  if (body.voice_profile !== undefined) patch.voice_profile = body.voice_profile;
  if (body.skill_profile !== undefined) patch.skill_profile = body.skill_profile;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  const { data, error } = await sb
    .from("personas")
    .update(patch)
    .eq("organization_id", ORG_ID)
    .eq("slug", params.slug)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, persona: data });
}
