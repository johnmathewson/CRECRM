/**
 * POST /api/properties/[id]/marketing/generate
 *
 * Body: { asset?: "description" | "flyer" | "om" | "social", dryRun?: boolean }
 *
 * For now only "description" is wired — first marketing asset. Other
 * assets will plug into the same route as we build them, sharing the
 * MarketingPropertyContext loader and writing to their own fields.
 *
 * Description generator writes back to:
 *   properties.headline      (string)
 *   properties.description   (string)
 *   properties.highlights    (jsonb array of strings)
 *
 * Returns the generated payload + a flag indicating whether the row
 * was persisted (dryRun=true skips the write so John can preview
 * before committing).
 *
 * Errors mid-flight don't trash the existing copy — we only write
 * after the generator returns valid JSON.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPropertyMarketingContext } from "@/lib/marketing/property-context";
import { generateDescription } from "@/lib/marketing/generate-description";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { asset?: "description" | "flyer" | "om" | "social"; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const asset = body.asset ?? "description";
  if (asset !== "description") {
    return NextResponse.json(
      { error: `Asset "${asset}" not implemented yet. Currently shipping: description.` },
      { status: 400 }
    );
  }

  const propertyId = params.id;
  const ctx = await loadPropertyMarketingContext(propertyId);
  if (!ctx) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  try {
    const generated = await generateDescription(ctx);

    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        asset,
        dryRun: true,
        generated,
        context_summary: contextSummary(ctx),
      });
    }

    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error: updateErr } = await sb
      .from("properties")
      .update({
        headline: generated.headline || null,
        description: generated.description || null,
        highlights: generated.highlights ?? [],
        investment_highlights: generated.investment_highlights ?? [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", propertyId)
      .eq("organization_id", ORG_ID);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: `Generated OK but failed to persist: ${updateErr.message}`, generated },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      asset,
      dryRun: false,
      generated,
      context_summary: contextSummary(ctx),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function contextSummary(ctx: { computed: any; saleComps: any[]; leaseComps: any[] }) {
  return {
    sale_comps_used: ctx.saleComps.length,
    lease_comps_used: ctx.leaseComps.length,
    median_sale_ppsf: ctx.computed.saleCompMedianPpsf,
    median_lease_rent: ctx.computed.leaseCompMedianRent,
    median_cap: ctx.computed.saleCompMedianCap,
    price_per_sf: ctx.computed.pricePerSf,
    vintage_band: ctx.computed.vintageBand,
  };
}
