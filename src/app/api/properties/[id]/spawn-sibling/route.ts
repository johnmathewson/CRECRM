/**
 * POST /api/properties/[id]/spawn-sibling
 *
 * Creates a "sibling" property record for the same physical building
 * offered under a different transaction_type — typically because the
 * owner wants to lease the space OR sell it, whichever closes first.
 *
 * The sibling shares:
 *   - Building identity: address, city, state, zip, county, apn,
 *     latitude/longitude
 *   - Building facts: sqft, acreage, year_built, parking, zoning,
 *     asset_type, sub_type, building_class, number_of_stories, etc.
 *   - Photos (images jsonb)
 *   - Marketing notes
 *
 * The sibling does NOT inherit:
 *   - transaction_type (it's the WHOLE POINT of the sibling — gets
 *     flipped to the opposite)
 *   - asking_price / lease_rate (different deal economics per side)
 *   - lease_type / available_sf / divisible_to_sf / lease_term_months /
 *     ti_allowance / free_rent_months / permitted_uses (lease-only)
 *   - External listing IDs: crexi_url / crexi_listing_id /
 *     loopnet_url / loopnet_listing_id (each side has its own listing)
 *   - Lifecycle timestamps: status starts at 'prospecting' for the
 *     new sibling regardless of source's stage
 *   - OM / Flyer PDFs (generated fresh per side)
 *
 * Both rows get their `related_property_id` set to each other so
 * the workspace can surface the link from either side.
 *
 * Body:
 *   { target_transaction_type?: "sale" | "lease" }
 *
 * If omitted, the target is the OPPOSITE of the source's
 * transaction_type — the common case. Returns the new property's
 * id + slug.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Slug helpers ───────────────────────────────────────────────────────────
// Mirror the slug logic used by POST /api/properties. The sibling needs
// its own unique slug (typically the source's slug + "-lease" or
// "-sale") because the workspace route is /cre-os/properties/[slug] —
// no slug means a hard 404 when clicking into the clone.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueSlug(sb: SupabaseClient, base: string): Promise<string> {
  if (!base) base = `property-${Date.now().toString(36)}`;
  let candidate = base;
  let n = 1;
  while (n <= 50) {
    const { data } = await sb
      .from("properties")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// Columns copied verbatim from the source. All "building identity" +
// "physical facts" columns — anything that describes the building
// rather than the deal.
const COPY_COLUMNS = [
  // Identity
  "name", "address", "city", "state", "zip", "county", "apn",
  "latitude", "longitude", "location",
  // Physical
  "asset_type", "sub_type", "sqft", "acreage", "year_built",
  "parking_spaces", "parking_ratio", "zoning", "building_class",
  "number_of_stories", "total_buildings", "tenancy",
  // Owner intel — these survive across sale/lease
  "owner_contact_id", "owner_name_raw", "owner_phone", "owner_contact_name",
  "owner_mailing_address", "owner_mailing_city", "owner_mailing_state", "owner_mailing_zip",
  "true_owner_name", "true_owner_phone", "true_owner_contact_name",
  "true_owner_address", "true_owner_city", "true_owner_state", "true_owner_zip",
  // Photos + marketing notes
  "images", "marketing_notes",
  // Marketing copy — carries over as a STARTING DRAFT so the broker
  // isn't writing from scratch on every clone. Sale-vs-lease copy is
  // genuinely different in tone, but starting from the source's text
  // and editing >> staring at a blank box. Re-running the description
  // generator on the clone will use lease-mode prompts and produce
  // tenant-shaped copy from these as inputs.
  "headline", "description", "highlights", "investment_highlights",
  // Market context
  "market_name", "submarket", "submarket_cluster",
];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { target_transaction_type?: "sale" | "lease" };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load the full source record so we can copy the building-facts.
  const { data: source, error: loadErr } = await sb
    .from("properties")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!source) return NextResponse.json({ error: "Source property not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const src = source as any;

  // If the source already has a sibling, don't allow spawning another.
  // A property can only have ONE sibling — sale↔lease is a 1:1 link.
  if (src.related_property_id) {
    return NextResponse.json(
      {
        error: "Source already has a sibling listing. Unlink it first or visit the existing sibling.",
        existing_sibling_id: src.related_property_id,
      },
      { status: 409 }
    );
  }

  // Decide the target transaction_type. Default: opposite of source.
  const sourceType = src.transaction_type;
  const targetType =
    body.target_transaction_type ??
    (sourceType === "sale" ? "lease" : sourceType === "lease" ? "sale" : null);

  if (!targetType) {
    return NextResponse.json(
      { error: `Source has no transaction_type set. Pass target_transaction_type explicitly.` },
      { status: 400 }
    );
  }
  if (targetType === sourceType) {
    return NextResponse.json(
      { error: `Source is already ${sourceType}. Pass the OPPOSITE target_transaction_type.` },
      { status: 400 }
    );
  }

  // Build the sibling payload — copy COPY_COLUMNS, then override the
  // deal-specific fields with the new transaction_type and clean slate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sibling: Record<string, any> = {
    organization_id: ORG_ID,
    transaction_type: targetType,
    // Fresh lifecycle — sibling starts at prospecting so John explicitly
    // walks it through Go-Live for its own readiness check.
    status: "prospecting",
    pipeline_stage: "Lead",
    publish_to_website: false,
    // Friendly default name suffix so the two are visually distinguishable
    // in lists. The broker can rename via Edit Details.
    name: src.name ? `${src.name} (${targetType === "sale" ? "For Sale" : "For Lease"})` : null,
  };

  for (const col of COPY_COLUMNS) {
    if (src[col] !== undefined && src[col] !== null) {
      sibling[col] = src[col];
    }
  }
  // Skip name copy from COPY_COLUMNS — we already set a suffixed name.
  // Re-apply the original name → set above; the loop overwrites it,
  // so re-apply after the loop.
  sibling.name = src.name
    ? `${src.name} (${targetType === "sale" ? "For Sale" : "For Lease"})`
    : `(For ${targetType === "sale" ? "Sale" : "Lease"})`;

  // Generate a unique slug — the workspace route is /properties/[slug],
  // so a null slug means a hard 404 when the broker clicks into the
  // clone. Prefer source_slug + suffix (keeps the relationship visible
  // in the URL), fall back to building from the address.
  const slugBase = src.slug
    ? `${src.slug}-${targetType === "sale" ? "sale" : "lease"}`
    : slugify(
        `${src.address ?? ""} ${src.city ?? ""} ${targetType === "sale" ? "sale" : "lease"}`.trim()
      );
  sibling.slug = await ensureUniqueSlug(sb, slugBase);

  // Insert the sibling.
  const { data: created, error: insertErr } = await sb
    .from("properties")
    .insert(sibling)
    .select("id, slug, name, transaction_type")
    .single();

  if (insertErr || !created) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create sibling" },
      { status: 500 }
    );
  }

  // Wire both directions — source ↔ sibling. Either side can navigate.
  const { error: linkSourceErr } = await sb
    .from("properties")
    .update({ related_property_id: created.id, updated_at: new Date().toISOString() })
    .eq("id", params.id);

  const { error: linkSiblingErr } = await sb
    .from("properties")
    .update({ related_property_id: params.id, updated_at: new Date().toISOString() })
    .eq("id", created.id);

  if (linkSourceErr || linkSiblingErr) {
    return NextResponse.json(
      {
        ok: false,
        error: "Sibling created but linking failed — fix related_property_id manually",
        sibling: created,
        link_errors: { source: linkSourceErr?.message, sibling: linkSiblingErr?.message },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    sibling: {
      id: created.id,
      slug: created.slug,
      name: created.name,
      transaction_type: created.transaction_type,
    },
  });
}
