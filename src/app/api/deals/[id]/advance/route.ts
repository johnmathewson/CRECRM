/**
 * POST /api/deals/[id]/advance
 *
 * Move a deal to a different stage. Idempotent — if you advance to the
 * stage you're already on, it's a no-op.
 *
 * Body: { stage: StageKey, notes?: string, sync_property?: boolean }
 *
 * When sync_property=true (default), the paired property's status is
 * updated to match the new stage's natural status — but only forward, never
 * backward (closing → leased/sold won't get rewound to "listed").
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeStage, type StageKey } from "@/lib/cre-os/stage-config";
import {
  statusForStage,
  isTerminalStatus,
  type PropertyStatus,
} from "@/lib/cre-os/property-status";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: { stage?: string; notes?: string; sync_property?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetStage: StageKey = normalizeStage(body.stage);
  const sb = svc();

  // ── Confirm deal exists + fetch current stage row ──
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_type, property_id, is_closed, is_dead")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.is_closed || deal.is_dead) {
    return NextResponse.json(
      { error: "Cannot advance a closed or dead deal" },
      { status: 409 }
    );
  }

  const { data: stages } = await sb
    .from("deal_stages")
    .select("id, stage, exited_at, entered_at")
    .eq("deal_id", deal.id)
    .order("entered_at", { ascending: false });

  const current = (stages ?? []).find((s) => !s.exited_at);
  const currentStage = normalizeStage(current?.stage);

  if (currentStage === targetStage) {
    return NextResponse.json({ deal_id: deal.id, stage: targetStage, changed: false });
  }

  // ── Exit current stage ──
  if (current) {
    await sb
      .from("deal_stages")
      .update({ exited_at: new Date().toISOString() })
      .eq("id", current.id);
  }

  // ── Enter new stage ──
  await sb.from("deal_stages").insert({
    deal_id: deal.id,
    stage: targetStage,
    entered_at: new Date().toISOString(),
    entered_by: USER_ID,
    notes: body.notes || null,
  });

  // ── Optionally sync the paired property's status ──
  let propertyUpdated = false;
  if (deal.property_id && body.sync_property !== false) {
    const txType = deal.deal_type === "lease" ? "lease" : "sale";
    const newStatus: PropertyStatus | null = statusForStage(targetStage, txType);
    if (newStatus) {
      const { data: prop } = await sb
        .from("properties")
        .select("status")
        .eq("id", deal.property_id)
        .maybeSingle();
      // Only forward — and don't disturb terminals
      if (prop && !isTerminalStatus(prop.status) && prop.status !== newStatus) {
        await sb
          .from("properties")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", deal.property_id);
        propertyUpdated = true;
      }
    }
  }

  return NextResponse.json({
    deal_id: deal.id,
    stage: targetStage,
    changed: true,
    property_updated: propertyUpdated,
  });
}
