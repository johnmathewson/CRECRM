/**
 * POST /api/properties/[id]/buyer-fit-assessment
 *
 * Generates a 1-page buyer-fit assessment PDF for the given property
 * against a specific buyer's criteria. Returns the PDF binary.
 *
 * Body:
 *   {
 *     buyerLabel?: string,         // e.g. "Mark Stevens @ Stevens Capital"
 *     assetTypes?: string[],       // e.g. ["Retail", "Industrial"]
 *     minSqft?: number,
 *     maxSqft?: number,
 *     maxPrice?: number,
 *     thesesText?: string,         // free-text value-add narrative
 *     marketRentPerSf?: number,    // optional broker override for lease-up assumption
 *     markToMarketLiftPerSf?: number,
 *     exitCapRate?: number         // decimal, e.g. 0.08
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generateBuyerFitPdf } from "@/lib/cre-os/buyer-fit-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface Body {
  buyerLabel?: string;
  assetTypes?: string[];
  minSqft?: number;
  maxSqft?: number;
  maxPrice?: number;
  thesesText?: string;
  marketRentPerSf?: number;
  markToMarketLiftPerSf?: number;
  exitCapRate?: number;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // Allow empty body — caller can request a default-criteria assessment
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: prop } = await sb
    .from("properties")
    .select(`
      name, address, city, state, zip, asset_type, sub_type, year_built,
      sqft, asking_price, noi, cap_rate, occupancy_pct, description
    `)
    .eq("organization_id", ORG_ID)
    .eq("id", params.id)
    .maybeSingle();
  if (!prop) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const pdfBytes = generateBuyerFitPdf({
    property: {
      name: prop.name,
      address: prop.address,
      city: prop.city,
      state: prop.state,
      zip: prop.zip,
      assetType: prop.asset_type,
      subType: prop.sub_type,
      yearBuilt: prop.year_built,
      sqft: prop.sqft,
      askingPrice: prop.asking_price ? Number(prop.asking_price) : null,
      noi: prop.noi ? Number(prop.noi) : null,
      capRate: prop.cap_rate ? Number(prop.cap_rate) : null,
      occupancyPct: prop.occupancy_pct ? Number(prop.occupancy_pct) : null,
      description: prop.description,
      marketRentPerSf: body.marketRentPerSf,
      markToMarketLiftPerSf: body.markToMarketLiftPerSf,
    },
    criteria: {
      buyerLabel: body.buyerLabel,
      assetTypes: body.assetTypes,
      minSqft: body.minSqft,
      maxSqft: body.maxSqft,
      maxPrice: body.maxPrice,
      thesesText: body.thesesText,
    },
    defaultMarketRentPerSf: body.marketRentPerSf ?? 16,
    defaultMarkToMarketLiftPerSf: body.markToMarketLiftPerSf ?? 3,
    exitCapRate: body.exitCapRate ?? 0.08,
  });

  const filename = `${(prop.name || "buyer-fit").replace(/[^A-Za-z0-9_-]+/g, "_")}_buyer_fit.pdf`;
  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
