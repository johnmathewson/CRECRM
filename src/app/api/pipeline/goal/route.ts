/**
 * POST /api/pipeline/goal — set the annual commission goal the Pipeline
 * scoreboard measures against. Session-authed. Body: { year?, goal }.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  const { data: { user } } = await createServerSupabase().auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { year?: number; goal?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const year = Number(body.year ?? new Date().getFullYear());
  const goal = Number(body.goal);
  if (!Number.isFinite(goal) || goal < 0 || goal > 1e9) {
    return NextResponse.json({ error: "goal must be a dollar amount" }, { status: 400 });
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { error } = await sb
    .from("broker_targets")
    .upsert({ organization_id: ORG_ID, year, commission_goal: goal, updated_at: new Date().toISOString() }, { onConflict: "organization_id,year" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, year, goal });
}
