/**
 * POST /api/prospector/personalize-draft
 *
 * Generate a single AI-personalized email draft for a one-off compose. This
 * is the same logic as the bulk-ai-followup endpoint, but for a single
 * recipient — used by the SendTouchDialog's "Generate AI draft" button so
 * the broker can preview/edit before sending.
 *
 * Body:
 *   {
 *     propertyId: string,
 *     recipient: { name?, email?, role?, company?, levelOfInterest?, visitCount?, lastActivityDate? }
 *   }
 *
 * Returns:
 *   { subject, body, rationale, archetype }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  personalizeTouch,
  archetypeFromContext,
  DEFAULT_SENDER,
} from "@/lib/cre-os/ai-touch-personalize";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface Body {
  propertyId: string;
  recipient?: {
    name?: string | null;
    email?: string | null;
    role?: string | null;
    company?: string | null;
    levelOfInterest?: string | null;
    visitCount?: number | null;
    lastActivityDate?: string | null;
  };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.propertyId) {
    return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: prop } = await supabase
    .from("properties")
    .select(`
      id, name, address, city, state, asset_type, sub_type, sqft, units,
      year_built, cap_rate, building_class, submarket, for_sale_status,
      years_owned, last_sale_price, mortgage_maturity_date, mortgage_lender,
      estimated_value, owner_name_raw, marketing_notes
    `)
    .eq("organization_id", ORG_ID)
    .eq("id", body.propertyId)
    .maybeSingle();
  if (!prop) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const propertyIsListing = !!(
    prop.for_sale_status &&
    ["active", "listed", "pending", "under_contract"].includes(
      String(prop.for_sale_status).toLowerCase()
    )
  );

  const recip = body.recipient ?? {};
  const archetype = archetypeFromContext({
    leadInterestLevel: recip.levelOfInterest,
    propertyIsListing,
  });

  try {
    const personalized = await personalizeTouch({
      channel: "email",
      archetype,
      property: {
        address: prop.address,
        city: prop.city,
        state: prop.state,
        assetType: prop.asset_type,
        sqft: prop.sqft,
        units: prop.units,
        yearBuilt: prop.year_built,
        capRate: prop.cap_rate ? Number(prop.cap_rate) : null,
        buildingClass: prop.building_class,
        submarket: prop.submarket,
        forSaleStatus: prop.for_sale_status,
        yearsOwned: prop.years_owned,
        lastSalePrice: prop.last_sale_price ? Number(prop.last_sale_price) : null,
        mortgageMaturityDate: prop.mortgage_maturity_date,
        mortgageLender: prop.mortgage_lender,
        estimatedValue: prop.estimated_value ? Number(prop.estimated_value) : null,
        name: prop.name,
        marketingNotes: prop.marketing_notes,
      },
      recipient: {
        name: recip.name ?? null,
        role: recip.role ?? null,
        company: recip.company ?? null,
        lastAction: recip.levelOfInterest ?? null,
        lastActionDate: recip.lastActivityDate ?? null,
        visitCount: recip.visitCount ?? null,
      },
      sender: DEFAULT_SENDER,
    });

    return NextResponse.json({
      ok: true,
      archetype,
      subject: personalized.subject,
      body: personalized.body,
      rationale: personalized.rationale,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `AI generate failed: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }
}
