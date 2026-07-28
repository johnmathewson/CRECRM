/**
 * PATCH /api/communications/[id] — mark a touch cleared/uncleared in the
 * Communications stream. Flips the existing is_read flag ONLY — no content
 * is ever modified or deleted; fully reversible.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authSb = createServerSupabase();
  const { data: { user } } = await authSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let cleared: boolean;
  try {
    const body = await req.json();
    cleared = Boolean(body?.cleared);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { error } = await sb
    .from("communications")
    .update({ is_read: cleared })
    .eq("organization_id", ORG_ID)
    .eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, cleared });
}
