/**
 * POST /api/deal-checkins/items/[id]/resolve
 *
 * Records what John did with the suggestions from his answer: the subset
 * he applied (the deal changes themselves go through the normal deal
 * routes from the client — PATCH /api/deals/[id], /advance, /close — so
 * commission math and property-status sync stay in one place), or that
 * he skipped them.
 *
 * Body: { applied?: object, skipped?: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: { applied?: Record<string, unknown>; skipped?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const now = new Date().toISOString();
  const update = body.skipped
    ? { skipped_at: now }
    : { applied_changes: body.applied ?? {}, applied_at: now };

  const { error } = await sb.from("deal_checkin_items").update(update).eq("id", params.id).eq("organization_id", ORG_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
