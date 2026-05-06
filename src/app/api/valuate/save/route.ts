import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

// Mirrors the asset-type normalizer in /api/properties so the DB check constraint
// doesn't reject "Retail (Strip Center)" etc. coming back from the engine.
const ASSET_TYPE_ALLOWED = new Set([
  "retail", "office", "industrial", "hospitality",
  "multifamily", "land", "medical", "mixed_use", "other",
]);
function normalizeAssetType(t: string | null | undefined): string | null {
  if (!t) return null;
  const v = t.toLowerCase().trim().replace(/[\s-]/g, "_").replace(/\(.*\)/g, "").trim();
  if (ASSET_TYPE_ALLOWED.has(v)) return v;
  if (["hotel", "motel", "inn", "lodging"].includes(v)) return "hospitality";
  if (["flex", "warehouse", "distribution"].includes(v)) return "industrial";
  if (["restaurant", "qsr", "fast_food"].includes(v)) return "retail";
  if (["apartment", "apartments", "residential"].includes(v)) return "multifamily";
  if (["healthcare", "clinic"].includes(v)) return "medical";
  return "other";
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function ensureUniqueSlug(supabase: any, base: string): Promise<string> {
  if (!base) base = `property-${Date.now().toString(36)}`;
  let candidate = base;
  let n = 1;
  while (n <= 50) {
    const { data } = await supabase
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

/**
 * POST /api/valuate/save
 *
 * Save a valuation result as a property record (and optionally create a deal at
 * Lead stage). One-stop persistence so the user doesn't lose the analysis.
 *
 * Body:
 *   address          string  (required) — full address from the valuation
 *   formattedAddress string  optional — geocoded canonical form
 *   city, state, zip string  optional
 *   assetType        string  required
 *   sqft             number  optional
 *   yearBuilt        number  optional
 *   occupancyPct     number  optional (0-100)
 *   stabilizedValue  number  optional — used as asking_price
 *   currentNOI       number  optional
 *   stabilizedRate   number  optional — used as lease_rate
 *   capRate          number  optional (decimal, e.g. 0.075)
 *   pricePerSf       number  optional
 *   propertyName     string  optional (default: address)
 *   yourRole         string  optional (default: "listing_broker")
 *   transactionType  string  optional (default: "sale")
 *   notes            string  optional
 *   addToDeals       bool    if true, also create a deal at Lead stage
 *   dealName         string  optional (default: "<address> — <transaction>")
 *
 * Returns: { propertyId, propertySlug, dealId? }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const body = await req.json();
    if (!body.address?.trim()) {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }

    const transactionType = body.transactionType || "sale";
    const yourRole = body.yourRole || "listing_broker";
    const name = (body.propertyName || body.address).toString().trim();
    const baseSlug = slugify(`${body.address} ${body.city || ""}`.trim());
    const slug = await ensureUniqueSlug(supabase, baseSlug);

    // Build property payload — only include fields with real values so we don't
    // overwrite DB defaults with empties.
    const propertyPayload: Record<string, any> = {
      organization_id: ORG_ID,
      name,
      address: body.address,
      asset_type: normalizeAssetType(body.assetType),
      status: "active",
      your_role: yourRole,
      transaction_type: transactionType,
      slug,
      data_source: "valuation_tool",
    };
    const optionalNumeric: [string, any][] = [
      ["sqft", body.sqft],
      ["year_built", body.yearBuilt],
      ["asking_price", body.stabilizedValue],
      ["lease_rate", body.stabilizedRate],
      ["noi", body.currentNOI],
      ["cap_rate", body.capRate],
      ["price_per_sf", body.pricePerSf],
      ["occupancy_pct", body.occupancyPct],
    ];
    for (const [k, v] of optionalNumeric) {
      if (v !== undefined && v !== null && v !== "" && !Number.isNaN(Number(v))) {
        propertyPayload[k] = Number(v);
      }
    }
    const optionalString: [string, any][] = [
      ["city", body.city],
      ["state", body.state],
      ["zip", body.zip],
      ["notes", body.notes],
    ];
    for (const [k, v] of optionalString) {
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        propertyPayload[k] = String(v).trim();
      }
    }

    const { data: property, error: propErr } = await supabase
      .from("properties")
      .insert(propertyPayload)
      .select("id, slug, name")
      .single();

    if (propErr || !property) {
      console.error("Property save error:", propErr);
      return NextResponse.json(
        { error: propErr?.message || "Failed to save property" },
        { status: 500 }
      );
    }

    // If addToDeals, create a deal + initial Lead-stage entry.
    let dealId: string | null = null;
    if (body.addToDeals) {
      const dealName = (body.dealName || `${name} — ${transactionType === "lease" ? "Lease" : "Sale"}`).toString().trim();
      const price = transactionType === "sale" ? (body.stabilizedValue ?? null) : (body.stabilizedRate ?? null);

      const { data: deal, error: dealErr } = await supabase
        .from("deals")
        .insert({
          organization_id: ORG_ID,
          property_id: property.id,
          deal_type: transactionType,
          deal_name: dealName,
          price: price !== null && price !== undefined && !Number.isNaN(Number(price)) ? Number(price) : null,
          probability_pct: 25, // sensible starting probability for a fresh listing
          assigned_to: USER_ID,
          notes: `Created from valuation tool · ${body.address}`,
        })
        .select("id")
        .single();

      if (dealErr || !deal) {
        console.error("Deal save error:", dealErr);
        // Property already saved — return partial success rather than 500.
        return NextResponse.json({
          propertyId: property.id,
          propertySlug: property.slug,
          dealId: null,
          dealError: dealErr?.message || "Failed to create deal",
        }, { status: 207 });
      }

      await supabase.from("deal_stages").insert({
        deal_id: deal.id,
        stage: "Lead",
        entered_at: new Date().toISOString(),
        entered_by: USER_ID,
        notes: "Created from valuation tool",
      });

      dealId = deal.id;
    }

    return NextResponse.json({
      propertyId: property.id,
      propertySlug: property.slug,
      dealId,
    }, { status: 201 });
  } catch (error: any) {
    console.error("Valuate save error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save valuation" },
      { status: 500 }
    );
  }
}
