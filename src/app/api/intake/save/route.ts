import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  try {
    const { propertyName, units, rawText, claudeResponse, fileName, fileType } =
      await req.json();

    if (!propertyName || !units?.length) {
      return NextResponse.json(
        { error: "Property name and units required" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Create intake record
    const { data: intake, error: intakeError } = await supabase
      .from("intakes")
      .insert({
        organization_id: ORG_ID,
        created_by: USER_ID,
        property_name: propertyName,
        file_name: fileName || null,
        file_type: fileType || null,
        raw_extracted_text: rawText || null,
        claude_raw_response: claudeResponse || null,
        status: "reviewed",
      })
      .select("id")
      .single();

    if (intakeError || !intake) {
      console.error("Intake insert error:", intakeError);
      return NextResponse.json(
        { error: intakeError?.message || "Failed to save intake" },
        { status: 500 }
      );
    }

    // Bulk insert units
    const unitRows = units.map((u: any, i: number) => ({
      intake_id: intake.id,
      unit_number: u.unit_number || null,
      tenant_name: u.tenant_name || null,
      suite: u.suite || null,
      square_footage: u.square_footage || null,
      lease_rate: u.lease_rate || null,
      lease_type: u.lease_type || null,
      lease_start: u.lease_start || null,
      lease_end: u.lease_end || null,
      monthly_rent: u.monthly_rent || null,
      annual_rent: u.annual_rent || null,
      escalation_pct: u.escalation_pct || null,
      is_vacant: u.is_vacant || false,
      notes: u.notes || null,
      sort_order: i,
    }));

    const { error: unitsError } = await supabase
      .from("intake_units")
      .insert(unitRows);

    if (unitsError) {
      console.error("Units insert error:", unitsError);
      return NextResponse.json(
        { error: unitsError.message || "Failed to save units" },
        { status: 500 }
      );
    }

    return NextResponse.json({ intakeId: intake.id });
  } catch (error: any) {
    console.error("Save error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to save" },
      { status: 500 }
    );
  }
}
