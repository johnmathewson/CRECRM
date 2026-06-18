/**
 * GET /api/agents/steward/latest
 *
 * Returns the (id, generated_at) of the most recent daily_briefing so
 * the Today's Brief page can poll for "is the regenerate done yet"
 * without re-fetching the full 8KB+ content_text every 5 seconds.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await supabase
    .from("daily_briefings")
    .select("id, generated_at, brief_date, email_sent_at")
    .eq("organization_id", ORG_ID)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ id: null, generated_at: null });
  return NextResponse.json(data);
}
