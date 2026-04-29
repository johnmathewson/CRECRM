import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const body = await req.json();

    // Validate required fields
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Property name is required" }, { status: 400 });
    }

    const orgId = body.organization_id || ORG_ID;

    // Build the insert payload — only include columns that exist in the properties table
    const insertPayload: Record<string, any> = {
      organization_id: orgId,
      name: body.name.trim(),
      status: body.status || "listed",
      asset_type: body.asset_type || null,
      your_role: body.your_role || "listing_broker",
    };

    // Optional fields — only set if provided and non-empty
    const optionalFields = [
      "address", "city", "state", "zip", "zoning",
      "asking_price", "lease_rate", "sqft", "acreage",
      "year_built", "parking_spaces", "parking_ratio",
      "noi", "cap_rate", "price_per_sf", "occupancy_pct",
      "description", "highlights", "notes", "crexi_url",
      "transaction_type", "publish_to_website", "crexi_sync_status",
      "source_import",
    ];

    for (const field of optionalFields) {
      if (body[field] !== undefined && body[field] !== null && body[field] !== "") {
        insertPayload[field] = body[field];
      }
    }

    const { data, error } = await supabase
      .from("properties")
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);

      // If extended columns don't exist yet (migration not run), fall back to base fields
      if (error.code === "42703" || error.message?.includes("column")) {
        const basePayload = {
          organization_id: orgId,
          name: body.name.trim(),
          status: body.status || "listed",
          asset_type: body.asset_type || null,
          your_role: body.your_role || "listing_broker",
          address: body.address || null,
          city: body.city || null,
          state: body.state || null,
          zip: body.zip || null,
          asking_price: body.asking_price || null,
          lease_rate: body.lease_rate || null,
          sqft: body.sqft || null,
          year_built: body.year_built || null,
          notes: body.notes || null,
        };
        const { data: data2, error: error2 } = await supabase
          .from("properties")
          .insert(basePayload)
          .select()
          .single();
        if (error2) {
          return NextResponse.json({ error: error2.message }, { status: 500 });
        }
        return NextResponse.json({ property: data2 }, { status: 201 });
      }
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
