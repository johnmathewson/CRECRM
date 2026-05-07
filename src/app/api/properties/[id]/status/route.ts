/**
 * POST /api/properties/[id]/status
 *
 * Change a property's lifecycle status with optional deal-side sync. The
 * primary deal tied to this property advances its stage in lockstep so the
 * pipeline view stays consistent with the property workspace.
 *
 * Body: { status: PropertyStatus, sync_deal?: boolean (default true), deal_notes?: string }
 *
 * Behavior:
 *   1. Update properties.status
 *   2. If no active deal exists for this property, create one at the right
 *      stage (handles the "John Howell" gap — listed property without deal)
 *   3. If an active deal exists, advance its stage when the new status maps
 *      forward, never backwards (a status from "listed" → "idea" doesn't
 *      rewind the deal — the deal handles its own backward moves)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  defaultStageForStatus,
  type PropertyStatus,
  PROPERTY_STATUS_META,
} from "@/lib/cre-os/property-status";
import { stageIndex, normalizeStage } from "@/lib/cre-os/stage-config";

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
  let body: { status?: string; sync_deal?: boolean; deal_notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const newStatus = body.status as PropertyStatus | undefined;
  if (!newStatus || !(newStatus in PROPERTY_STATUS_META)) {
    return NextResponse.json(
      { error: `status must be one of ${Object.keys(PROPERTY_STATUS_META).join(", ")}` },
      { status: 400 }
    );
  }

  const sb = svc();

  // ── 1. Update property ──
  const { data: property, error: pErr } = await sb
    .from("properties")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .select("id, name, transaction_type")
    .single();

  if (pErr || !property) {
    return NextResponse.json(
      { error: pErr?.message || "Property not found" },
      { status: 404 }
    );
  }

  // ── 2. Reconcile with paired deal ──
  let dealAction: "none" | "created" | "advanced" | "skipped_terminal" = "none";

  if (body.sync_deal !== false && newStatus !== "dead") {
    const targetStage = defaultStageForStatus(newStatus);

    // Find any active (not closed, not dead) deal for this property
    const { data: activeDeal } = await sb
      .from("deals")
      .select("id, deal_type, deal_name, deal_stages(stage, exited_at, entered_at)")
      .eq("organization_id", ORG_ID)
      .eq("property_id", params.id)
      .eq("is_closed", false)
      .eq("is_dead", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeDeal) {
      // No deal yet — create one (this is the John Howell fix path)
      const txType: "sale" | "lease" =
        property.transaction_type === "lease" ? "lease" : "sale";
      const { data: newDeal } = await sb
        .from("deals")
        .insert({
          organization_id: ORG_ID,
          property_id: property.id,
          deal_type: txType,
          deal_name: `${property.name} — ${txType === "lease" ? "Lease" : "Sale"}`,
          probability_pct: 50,
          assigned_to: USER_ID,
        })
        .select("id")
        .single();

      if (newDeal) {
        await sb.from("deal_stages").insert({
          deal_id: newDeal.id,
          stage: targetStage,
          entered_at: new Date().toISOString(),
          entered_by: USER_ID,
          notes: body.deal_notes || `Auto-created when property advanced to "${newStatus}"`,
        });
        dealAction = "created";
      }
    } else {
      // Deal exists — find current stage
      const stages = (activeDeal.deal_stages || []) as any[];
      const currentRow = stages.find((s) => !s.exited_at) ||
                         stages.sort((a, b) => (b.entered_at ?? "").localeCompare(a.entered_at ?? ""))[0];
      const currentStage = normalizeStage(currentRow?.stage);

      // Only move forward — don't rewind a deal
      if (stageIndex(targetStage) > stageIndex(currentStage)) {
        // Exit current
        if (currentRow && !currentRow.exited_at) {
          await sb
            .from("deal_stages")
            .update({ exited_at: new Date().toISOString() })
            .eq("deal_id", activeDeal.id)
            .is("exited_at", null);
        }
        await sb.from("deal_stages").insert({
          deal_id: activeDeal.id,
          stage: targetStage,
          entered_at: new Date().toISOString(),
          entered_by: USER_ID,
          notes: body.deal_notes || `Property status → "${newStatus}"`,
        });
        dealAction = "advanced";
      } else {
        dealAction = "skipped_terminal";
      }
    }
  }

  return NextResponse.json({
    property: { id: property.id, status: newStatus },
    deal_action: dealAction,
  });
}
