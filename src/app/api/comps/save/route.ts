import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  try {
    const { comps, source, fileName, intakeId } = await req.json();
    if (!comps?.length) return NextResponse.json({ error: "No comps provided" }, { status: 400 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const rows = comps.map((c: any) => ({
      organization_id: ORG_ID,
      intake_id: intakeId || null,
      property_name: c.property_name || "Unknown",
      address: c.address || null,
      city: c.city || null,
      state: c.state || null,
      submarket: c.submarket || null,
      asset_type: c.asset_type || null,
      source: source || null,
      file_name: fileName || null,
      tenant_name: c.tenant_name || null,
      suite: c.suite || null,
      square_footage: c.square_footage || null,
      lease_rate: c.lease_rate || null,
      lease_type: c.lease_type || null,
      lease_start: c.lease_start || null,
      lease_end: c.lease_end || null,
      monthly_rent: c.monthly_rent || null,
      annual_rent: c.annual_rent || null,
      is_vacant: c.is_vacant || false,
      notes: c.notes || null,
    }));

    const { error } = await supabase.from("comps").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ saved: rows.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
