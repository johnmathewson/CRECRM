/**
 * POST /api/properties/[id]/lifecycle
 *
 * Property state-machine endpoint. One route handles every forward
 * transition through the property lifecycle:
 *
 *   Lead → Prospecting → Pitched → Listed → Under Contract → Closed
 *
 * The existing /promote route handles a specific prospect→prospecting
 * shortcut from the lane workflow. This route is the generic state
 * machine for the Go-Live + Pipeline kanban flows.
 *
 * Body:
 *   {
 *     to: "prospecting" | "pitched" | "listed" | "under_contract" | "closed",
 *     dryRun?: boolean,         // returns readiness check without writing
 *     skipReadinessCheck?: boolean, // override warnings (rare; force-list)
 *   }
 *
 * Side effects per transition:
 *   - status + pipeline_stage updated atomically
 *   - matching *_at timestamp stamped (idempotent — preserves the
 *     first transition date if re-promoted)
 *   - publish_to_website flipped true on Listed
 *   - lead_events row appended for audit + Steward to read tomorrow
 *
 * The "listed" transition runs a READINESS CHECK first: asking price,
 * description, photos, headline, etc. Block-severity gaps stop the
 * promotion unless skipReadinessCheck=true; warn-severity gaps are
 * surfaced but don't block.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

type Stage = "prospecting" | "pitched" | "listed" | "under_contract" | "closed";

const TRANSITIONS: Record<Stage, {
  status: string;
  pipeline_stage: string;
  stamp_column: string | null;
  label: string;
}> = {
  prospecting: { status: "prospecting", pipeline_stage: "Lead", stamp_column: "prospecting_started_at", label: "Prospecting" },
  pitched: { status: "pitched", pipeline_stage: "Lead", stamp_column: "pitched_at", label: "Pitched" },
  listed: { status: "listed", pipeline_stage: "Listing", stamp_column: "listed_at", label: "Listed" },
  under_contract: { status: "under_contract", pipeline_stage: "Under Contract", stamp_column: "under_contract_at", label: "Under Contract" },
  closed: { status: "sold", pipeline_stage: "Closed", stamp_column: "closed_at", label: "Closed" },
};

interface ReadinessGap {
  key: string;
  label: string;
  severity: "block" | "warn";
  message: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkListingReadiness(p: any): ReadinessGap[] {
  const gaps: ReadinessGap[] = [];
  const isLease = p.transaction_type === "lease";

  // Money fields — different per mode. Sale needs asking_price, lease
  // needs lease_rate. Either way the listing can't go live without
  // an economic anchor.
  if (isLease) {
    if (!p.lease_rate || Number(p.lease_rate) <= 0) {
      gaps.push({ key: "lease_rate", label: "Lease rate", severity: "block", message: "Set the lease rate ($/SF/yr) before listing — tenants can't engage without it." });
    }
    if (!p.available_sf || Number(p.available_sf) <= 0) {
      gaps.push({ key: "available_sf", label: "Available SF", severity: "block", message: "Set the available SF — tenants need to know how much space is on the table." });
    }
    if (!p.lease_type) {
      gaps.push({ key: "lease_type", label: "Lease type", severity: "warn", message: "Lease type (NNN / gross / modified) is one of the first things a tenant or their broker asks." });
    }
  } else {
    if (!p.asking_price || Number(p.asking_price) <= 0) {
      gaps.push({ key: "asking_price", label: "Asking price", severity: "block", message: "Set the asking price before listing — buyers can't engage without it." });
    }
  }

  // Marketing copy + assets — same for both modes.
  if (!p.headline || String(p.headline).trim().length < 6) {
    gaps.push({ key: "headline", label: "Headline", severity: "block", message: "Add a headline so the listing has a marketable hook." });
  }
  if (!p.description || String(p.description).trim().length < 80) {
    gaps.push({ key: "description", label: "Description", severity: "block", message: "Generate or write a description before going live." });
  }
  // The "investment_highlights" column holds tenant-side highlights on
  // lease properties (same column, different label per mode).
  if (!Array.isArray(p.investment_highlights) || p.investment_highlights.length < 3) {
    gaps.push({
      key: "investment_highlights",
      label: isLease ? "Lease highlights" : "Investment highlights",
      severity: "warn",
      message: isLease
        ? "At least 3 lease highlights help the flyer carry weight with tenant decisions."
        : "At least 3 investment highlights help the flyer carry weight.",
    });
  }
  if (!Array.isArray(p.highlights) || p.highlights.length < 3) {
    gaps.push({ key: "highlights", label: "Property highlights", severity: "warn", message: "Property highlights help round out the marketing assets." });
  }
  if (!Array.isArray(p.images) || p.images.length === 0) {
    gaps.push({ key: "images", label: "Photos", severity: "block", message: "Upload at least one property photo — the flyer hero depends on it." });
  } else if (p.images.length < 3) {
    gaps.push({ key: "images_more", label: "More photos", severity: "warn", message: "3+ photos make the OM and flyer dramatically stronger." });
  }
  if (!p.asset_type) {
    gaps.push({ key: "asset_type", label: "Asset type", severity: "block", message: "Set the asset type (industrial, retail, etc.)." });
  }
  return gaps;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { to?: Stage; dryRun?: boolean; skipReadinessCheck?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = body.to;
  if (!to || !TRANSITIONS[to]) {
    return NextResponse.json(
      { error: `'to' must be one of: ${Object.keys(TRANSITIONS).join(", ")}` },
      { status: 400 }
    );
  }
  const target = TRANSITIONS[to];

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: row, error: loadErr } = await sb
    .from("properties")
    .select(
      "id, name, status, pipeline_stage, asset_type, asking_price, headline, description, " +
        "highlights, investment_highlights, images, listed_at, prospecting_started_at, " +
        "pitched_at, under_contract_at, closed_at, publish_to_website, " +
        // For-lease specific fields used by the readiness check.
        "transaction_type, lease_rate, available_sf, lease_type"
    )
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (loadErr || !row) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }
  // The new lifecycle timestamp columns aren't in Supabase's
  // generated types yet — cast at this seam so the rest of the
  // handler stays clean.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const property = row as any;

  const gaps: ReadinessGap[] = to === "listed" ? checkListingReadiness(property) : [];
  const blockers = gaps.filter((g) => g.severity === "block");

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      current: { status: property.status, pipeline_stage: property.pipeline_stage },
      target: { status: target.status, pipeline_stage: target.pipeline_stage, label: target.label },
      ready: blockers.length === 0,
      gaps,
    });
  }

  if (blockers.length > 0 && !body.skipReadinessCheck) {
    return NextResponse.json(
      { ok: false, reason: "readiness_check_failed", gaps, blockers },
      { status: 412 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {
    status: target.status,
    pipeline_stage: target.pipeline_stage,
    updated_at: new Date().toISOString(),
  };
  const now = new Date().toISOString();
  if (target.stamp_column) {
    // Idempotent — only stamp if currently null. Preserves the
    // original transition date on a re-promote.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentStamp = (property as any)[target.stamp_column];
    if (!currentStamp) update[target.stamp_column] = now;
  }
  if (to === "listed") {
    update.publish_to_website = true;
  }

  const { error: updErr } = await sb
    .from("properties")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Audit + signal for Steward + future Sourcing agent broadcasts.
  try {
    await sb.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: null,
      event_type: `property_promoted_${to}`,
      actor: "user",
      summary: `${property.name ?? params.id} promoted to ${target.label}`,
      metadata: {
        property_id: params.id,
        from_status: property.status,
        from_pipeline_stage: property.pipeline_stage,
        to_status: target.status,
        to_pipeline_stage: target.pipeline_stage,
        stamp_column: target.stamp_column,
        warnings: gaps.filter((g) => g.severity === "warn").map((g) => g.key),
        skipped_readiness_check: !!body.skipReadinessCheck,
      },
    });
  } catch (err) {
    console.error("[lifecycle] audit log failed:", err);
  }

  return NextResponse.json({
    ok: true,
    promoted_to: target.label,
    status: target.status,
    pipeline_stage: target.pipeline_stage,
    stamped_at: target.stamp_column ? now : null,
    warnings: gaps.filter((g) => g.severity === "warn"),
  });
}
