/**
 * POST /api/properties/[id]/marketing/flyer
 *
 * Generates a 1-page property flyer PDF:
 *   1. Loads the marketing context (property + voice profile)
 *   2. Fetches the hero image from properties.images[0]
 *   3. Renders the flyer via generateFlyer()
 *   4. Uploads to Supabase Storage (marketing-pdfs bucket)
 *   5. Writes flyer_pdf_url + flyer_generated_at to the property row
 *
 * Body: { dryRun?: boolean } — dryRun streams the PDF directly,
 *       no DB write, no Storage write. Useful for previewing.
 *
 * Same shape as the OM route, different generator.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPropertyMarketingContext } from "@/lib/marketing/property-context";
import { generateFlyer } from "@/lib/marketing/generate-flyer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BUCKET = "marketing-pdfs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const propertyId = params.id;
  const ctx = await loadPropertyMarketingContext(propertyId);
  if (!ctx) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  let result: Awaited<ReturnType<typeof generateFlyer>>;
  try {
    result = await generateFlyer(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `Flyer render failed: ${msg}` }, { status: 500 });
  }

  if (body.dryRun) {
    return new NextResponse(new Uint8Array(result.pdfBytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${result.filename}"`,
        "cache-control": "no-store",
      },
    });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[^0-9]/g, "").slice(0, 14);
  const storagePath = `${propertyId}/${stamp}_${result.filename}`;

  const { error: uploadErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, result.pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    return NextResponse.json(
      { ok: false, error: `Storage upload failed: ${uploadErr.message}` },
      { status: 500 }
    );
  }

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = pub.publicUrl;

  const { error: updateErr } = await sb
    .from("properties")
    .update({
      flyer_pdf_url: publicUrl,
      flyer_generated_at: generatedAt,
      updated_at: generatedAt,
    })
    .eq("id", propertyId)
    .eq("organization_id", ORG_ID);

  if (updateErr) {
    return NextResponse.json(
      {
        ok: false,
        error: `Flyer uploaded but failed to persist URL: ${updateErr.message}`,
        flyer_pdf_url: publicUrl,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    flyer_pdf_url: publicUrl,
    filename: result.filename,
    generated_at: generatedAt,
    storage_path: storagePath,
  });
}
