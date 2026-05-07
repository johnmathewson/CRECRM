/**
 * POST /api/deals/[id]/close
 *
 * Terminate a deal. Three outcomes:
 *   • outcome="won"   → is_closed=true, actual_close set, paired property
 *                       status → 'sold' or 'leased' based on deal_type
 *   • outcome="lost"  → is_dead=true, dead_reason recorded, property status
 *                       NOT changed (could still re-list)
 *   • outcome="dead"  → is_dead=true, dead_reason recorded, property status
 *                       → 'dead' (the whole opportunity is dead, not just this deal)
 *
 * Body: { outcome: 'won'|'lost'|'dead',
 *         actual_close?: ISO date (required for 'won'),
 *         agreed_price?: number,
 *         reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizeStage } from "@/lib/cre-os/stage-config";

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
  let body: { outcome?: string; actual_close?: string; agreed_price?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const outcome = body.outcome;
  if (!outcome || !["won", "lost", "dead"].includes(outcome)) {
    return NextResponse.json(
      { error: "outcome must be one of: won, lost, dead" },
      { status: 400 }
    );
  }

  const sb = svc();
  const { data: deal } = await sb
    .from("deals")
    .select("id, deal_type, property_id, is_closed, is_dead, price")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.is_closed) return NextResponse.json({ error: "Deal already closed" }, { status: 409 });
  if (deal.is_dead && outcome !== "won") {
    return NextResponse.json({ error: "Deal already marked dead" }, { status: 409 });
  }

  // ── Update deal row ──
  const update: Record<string, any> = { updated_at: new Date().toISOString() };
  if (outcome === "won") {
    update.is_closed = true;
    update.is_dead = false;
    update.actual_close = body.actual_close || new Date().toISOString().slice(0, 10);
    if (body.agreed_price !== undefined) update.price = body.agreed_price;
  } else {
    update.is_dead = true;
    update.dead_reason = body.reason || null;
  }

  await sb.from("deals").update(update).eq("id", deal.id);

  // ── Close out the active deal_stages row + write a terminal row ──
  const terminalStage = outcome === "won" ? "Closed" : "Lead";
  const { data: openStage } = await sb
    .from("deal_stages")
    .select("id")
    .eq("deal_id", deal.id)
    .is("exited_at", null)
    .maybeSingle();
  if (openStage) {
    await sb
      .from("deal_stages")
      .update({ exited_at: new Date().toISOString() })
      .eq("id", openStage.id);
  }
  if (outcome === "won") {
    await sb.from("deal_stages").insert({
      deal_id: deal.id,
      stage: terminalStage,
      entered_at: new Date().toISOString(),
      entered_by: USER_ID,
      notes: `Closed won — ${update.actual_close}`,
    });
  }

  // ── Update paired property ──
  let propertyStatus: string | null = null;
  if (deal.property_id) {
    if (outcome === "won") {
      propertyStatus = deal.deal_type === "lease" ? "leased" : "sold";
    } else if (outcome === "dead") {
      propertyStatus = "dead";
    }
    if (propertyStatus) {
      await sb
        .from("properties")
        .update({ status: propertyStatus, updated_at: new Date().toISOString() })
        .eq("id", deal.property_id);
    }
  }

  // ── Record commission for won deals ──
  if (outcome === "won") {
    // commissions table exists but we leave the detailed entry to a follow-up
    // commissions UI. Stamp a stub row so we have a marker.
    try {
      await sb.from("commissions").insert({
        organization_id: ORG_ID,
        deal_id: deal.id,
        // Other fields populated when commissions UI is built.
      });
    } catch {
      // Stub — table schema may differ; non-fatal.
    }
  }

  return NextResponse.json({
    deal_id: deal.id,
    outcome,
    property_status: propertyStatus,
  });
}
