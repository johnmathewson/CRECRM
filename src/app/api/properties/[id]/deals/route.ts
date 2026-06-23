/**
 * GET /api/properties/[id]/deals
 *
 * Returns the OPEN deals (not closed, not dead) attached to this
 * property, with the fields the peek panel needs for inline edit:
 * price, commission_pct, estimated_commission, weighted_commission,
 * probability_pct, stage history's latest entry, deal_type.
 *
 * The peek panel renders an editable section per deal so the broker
 * can fix a stale price or set commission without leaving the
 * kanban → peek workflow.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await sb
    .from("deals")
    .select(
      `id, deal_name, deal_type, price, commission_pct,
       estimated_commission, weighted_commission, probability_pct,
       expected_close, created_at,
       deal_stages(stage, entered_at, exited_at)`
    )
    .eq("organization_id", ORG_ID)
    .eq("property_id", params.id)
    .eq("is_closed", false)
    .eq("is_dead", false)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Surface the current stage by picking the row without exited_at,
  // falling back to the most recent stage row.
  const deals = (data ?? []).map((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = ((d as any).deal_stages ?? []) as { stage: string; entered_at: string; exited_at: string | null }[];
    const active = stages.find((s) => !s.exited_at)
      ?? [...stages].sort((a, b) => new Date(b.entered_at).getTime() - new Date(a.entered_at).getTime())[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { deal_stages: _drop, ...rest } = d as any;
    void _drop;
    return { ...rest, stage: active?.stage ?? null };
  });

  return NextResponse.json({ deals });
}
