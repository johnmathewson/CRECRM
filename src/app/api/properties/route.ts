import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Asset-type normalization ────────────────────────────────────────────────
// DB check constraint allows exactly these. Anything else (e.g. AI extraction
// returning "hotel" or "flex") gets mapped to its closest valid sibling so we
// don't 500 on an otherwise-good listing save.
const ASSET_TYPE_ALLOWED = new Set([
  "retail", "office", "industrial", "hospitality",
  "multifamily", "land", "medical", "mixed_use", "other",
]);
function normalizeAssetType(t: string | null | undefined): string | null {
  if (!t) return null;
  const v = t.toLowerCase().trim().replace(/[\s-]/g, "_");
  if (ASSET_TYPE_ALLOWED.has(v)) return v;
  // Common aliases
  if (["hotel", "motel", "inn", "lodging"].includes(v)) return "hospitality";
  if (["flex", "warehouse", "distribution"].includes(v)) return "industrial";
  if (["restaurant", "qsr", "fast_food"].includes(v)) return "retail";
  if (["apartment", "apartments", "residential"].includes(v)) return "multifamily";
  if (["healthcare", "clinic"].includes(v)) return "medical";
  return "other";
}

// ── Slug generation ─────────────────────────────────────────────────────────
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildBaseSlug(address?: string, city?: string, name?: string): string {
  if (address && city) return slugify(`${address} ${city}`);
  if (address) return slugify(address);
  if (name) return slugify(name);
  return "";
}

async function ensureUniqueSlug(
  supabase: any,
  base: string,
  excludeId?: string
): Promise<string> {
  if (!base) base = `property-${Date.now().toString(36)}`;
  let candidate = base;
  let n = 1;
  while (true) {
    const query = supabase.from("properties").select("id").eq("slug", candidate);
    const { data, error } = excludeId
      ? await query.neq("id", excludeId).maybeSingle()
      : await query.maybeSingle();
    if (error && error.code !== "PGRST116") {
      // unexpected error — give up uniqueness search, append timestamp
      return `${base}-${Date.now().toString(36)}`;
    }
    if (!data) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
    if (n > 50) return `${base}-${Date.now().toString(36)}`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const body = await req.json();

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Property name is required" }, { status: 400 });
    }

    const orgId = body.organization_id || ORG_ID;

    const insertPayload: Record<string, any> = {
      organization_id: orgId,
      name: body.name.trim(),
      status: body.status || "listed",
      asset_type: normalizeAssetType(body.asset_type),
      your_role: body.your_role || "listing_broker",
    };

    const optionalFields = [
      "address", "city", "state", "zip", "zoning",
      "asking_price", "lease_rate", "sqft", "acreage",
      "year_built", "parking_spaces", "parking_ratio",
      "noi", "cap_rate", "price_per_sf", "occupancy_pct",
      "description", "highlights", "notes", "crexi_url",
      "transaction_type", "publish_to_website", "crexi_sync_status",
      "source_import",
      // publish-path fields
      "headline", "images",
    ];

    for (const field of optionalFields) {
      if (body[field] !== undefined && body[field] !== null && body[field] !== "") {
        insertPayload[field] = body[field];
      }
    }

    // Auto-generate slug if not provided. If provided, slugify and dedupe.
    const slugSource =
      body.slug?.trim() ||
      buildBaseSlug(body.address, body.city, body.name);
    insertPayload.slug = await ensureUniqueSlug(supabase, slugify(slugSource));

    const { data, error } = await supabase
      .from("properties")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ property: data }, { status: 201 });
  } catch (error: any) {
    console.error("Properties POST error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create property" },
      { status: 500 }
    );
  }
}
