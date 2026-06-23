/**
 * GET    /api/properties/[id]  — full row
 * PATCH  /api/properties/[id]  — partial update (any column on properties)
 * DELETE /api/properties/[id]  — soft delete (sets is_dead=true).
 *                                 Preserves tied deals/leads/comms history.
 *
 * Used by the Edit Listing modal, the "Publish to Website" toggle, and
 * the property archive controls (card menu + workspace danger zone).
 * Slug is regenerated from address+city only when address or city changes
 * AND no slug was supplied — preserves existing public URLs by default.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// Whitelist of columns the API will let you patch. Keeps random keys from
// landing in the DB and prevents accidental ID/org swaps.
const PATCHABLE_FIELDS = new Set([
  "name", "headline", "address", "city", "state", "zip",
  "asset_type", "transaction_type", "status", "your_role",
  "asking_price", "lease_rate", "sqft", "acreage", "year_built",
  "parking_spaces", "parking_ratio", "zoning",
  // For-lease structure — surfaces via the Edit dialog when
  // transaction_type='lease'. See migration add_lease_specific_property_columns.
  "lease_type", "available_sf", "divisible_to_sf", "lease_term_months",
  "ti_allowance_per_sf", "free_rent_months", "suite_breakdown", "permitted_uses",
  // Location anchoring — for properties without a clean street
  // address. Set via PropertyLocationPicker (click-to-pin map).
  "latitude", "longitude", "apn", "county",
  "noi", "cap_rate", "price_per_sf", "occupancy_pct",
  "description", "highlights", "investment_highlights", "notes", "marketing_notes", "document_inventory",
  // External listing URLs + the numeric listing IDs the CREXi lead
  // parser uses to route inbound leads to the right property. When
  // crexi_url is updated below, crexi_listing_id is auto-extracted
  // from it server-side. Same for loopnet.
  "crexi_url", "crexi_listing_id", "loopnet_url", "loopnet_listing_id",
  // LoopNet/CoStar shared performance-report URL — token rotates every
  // ~30 days, so John refreshes it monthly via the property edit form.
  // loopnet_share_url_set_at is auto-stamped server-side on update below.
  "loopnet_share_url",
  "publish_to_website", "crexi_sync_status", "source_import",
  "headline", "images", "slug",
  // Unified pipeline + folded-in deal financials (migration 0003)
  "pipeline_stage",
  "agreed_price", "commission_pct", "estimated_commission",
  "probability_pct", "weighted_commission",
  "expected_close", "actual_close",
  "is_dead", "dead_reason",
  "client_contact_id", "assigned_to",
]);

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = svc();
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ property: data });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE_FIELDS.has(k)) update[k] = v;
  }
  // Normalize asset_type if present — same mapping as the create endpoint.
  if (typeof update.asset_type === "string") {
    const allowed = new Set(["retail", "office", "industrial", "hospitality", "multifamily", "land", "medical", "mixed_use", "other"]);
    const v = update.asset_type.toLowerCase().trim().replace(/[\s-]/g, "_");
    if (allowed.has(v)) update.asset_type = v;
    else if (["hotel", "motel", "inn", "lodging"].includes(v)) update.asset_type = "hospitality";
    else if (["flex", "warehouse", "distribution"].includes(v)) update.asset_type = "industrial";
    else if (["restaurant", "qsr", "fast_food"].includes(v)) update.asset_type = "retail";
    else if (["apartment", "apartments", "residential"].includes(v)) update.asset_type = "multifamily";
    else if (["healthcare", "clinic"].includes(v)) update.asset_type = "medical";
    else update.asset_type = "other";
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  // Auto-stamp loopnet_share_url_set_at when the share URL is being updated.
  // The token rotates every ~30 days; this is how the UI knows when to
  // surface a "expires in N days" warning + refresh prompt.
  if ("loopnet_share_url" in update) {
    update.loopnet_share_url_set_at = update.loopnet_share_url
      ? new Date().toISOString()
      : null;
  }

  // Auto-extract the CREXi/LoopNet listing IDs from URL changes. The
  // CREXi lead parser routes inbound leads to properties by crexi_listing_id,
  // so without this step the broker would have to paste the URL AND
  // manually pull the numeric ID out of it.
  //
  // CREXi URL: https://www.crexi.com/properties/<ID>/<slug>
  // LoopNet URL: https://www.loopnet.com/Listing/<ID> or /Listing/<ID>/<slug>
  if ("crexi_url" in update) {
    const extracted = extractCrexiListingId(update.crexi_url);
    // Only overwrite the saved ID when we successfully parse one OR
    // when the URL is being cleared (both go null together).
    if (extracted !== null || !update.crexi_url) {
      update.crexi_listing_id = extracted;
    }
  }
  if ("loopnet_url" in update) {
    const extracted = extractLoopnetListingId(update.loopnet_url);
    if (extracted !== null || !update.loopnet_url) {
      update.loopnet_listing_id = extracted;
    }
  }

  update.updated_at = new Date().toISOString();

  const supabase = svc();
  const { data, error } = await supabase
    .from("properties")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ property: data });
}

/**
 * Soft delete. Sets is_dead=true so the property disappears from active
 * lists (which already filter `is_dead=false`) but tied history — deals,
 * leads, communications, sale_comps, listing_metrics — stays intact.
 * Reversal is a simple PATCH { is_dead: false }.
 *
 * Optional body:
 *   { reason?: string }
 *     → stored on dead_reason for audit. Defaults to "archived_by_user".
 *
 * Returns the archived row so the client can confirm the operation.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  // Body is optional — accept empty / missing JSON without error.
  let reason = "archived_by_user";
  try {
    const body = await req.json();
    if (body && typeof body.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 200);
    }
  } catch {
    // empty body → use default
  }

  const supabase = svc();
  const { data, error } = await supabase
    .from("properties")
    .update({
      is_dead: true,
      dead_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .select("id, name, address, is_dead, dead_reason")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, property: data });
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Extract the numeric CREXi listing ID from a CREXi URL. Returns null
 * when the input isn't a recognizable CREXi URL — including empty/null/
 * undefined, so callers can also pass through clearing operations
 * without special-casing.
 *
 * Matched shapes (both broker-dashboard and public-listing forms):
 *   https://www.crexi.com/property/815297/dashboard        (broker view)
 *   https://www.crexi.com/properties/2475450/anything       (public listing)
 *   https://crexi.com/property/815297
 *   crexi.com/properties/2475450/slug?utm=…
 *   /property/815297 or /properties/2475450  (relative)
 *   815297 (bare ID — accepted as-is so the broker can paste just the number)
 */
function extractCrexiListingId(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Bare ID (broker pasted just the number).
  if (/^\d{4,}$/.test(trimmed)) return trimmed;
  // /property/<digits> OR /properties/<digits>. CREXi uses singular
  // "property" in the broker dashboard URL and plural "properties"
  // in the public listing URL — both point at the same listing.
  const m = trimmed.match(/\/propert(?:y|ies)\/(\d{4,})/i);
  if (m) return m[1];
  return null;
}

/**
 * Extract the numeric LoopNet listing ID from a LoopNet property URL.
 *
 * Matched shapes:
 *   https://www.loopnet.com/Listing/12345678/Address/
 *   https://loopnet.com/Listing/12345678
 *   /Listing/12345678 (relative)
 *   12345678 (bare ID)
 *
 * LoopNet IDs are typically 7-9 digits.
 */
function extractLoopnetListingId(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^\d{6,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/Listing\/(\d{6,})/i);
  if (m) return m[1];
  return null;
}
