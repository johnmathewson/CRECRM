/**
 * POST /api/properties/[id]/marketing/om
 *
 * Generates an Offering Memorandum PDF for the property:
 *   1. Loads the marketing context (property + comps + voice profile)
 *   2. Renders multi-page PDF via generateOm()
 *   3. Uploads to Supabase Storage (marketing-pdfs bucket)
 *   4. Writes the public URL + timestamp to the property row
 *
 * Returns { ok, om_pdf_url, page_count, filename, generated_at }.
 *
 * Body: { dryRun?: boolean }
 *   - dryRun:true streams the PDF directly without writing to DB or
 *     Storage. Useful for previewing during prompt iteration.
 *
 * Same pattern as the description generator — the marketing engine
 * grows by adding asset-specific routes that all consume the shared
 * MarketingPropertyContext.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPropertyMarketingContext } from "@/lib/marketing/property-context";
import { generateOm } from "@/lib/marketing/generate-om";

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

  let result: ReturnType<typeof generateOm>;
  try {
    result = generateOm(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: `OM render failed: ${msg}` }, { status: 500 });
  }

  // Dry-run: stream the PDF straight back. Caller can save locally or
  // preview before committing. No Storage write, no DB write.
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

  // Path: <propertyId>/<timestamp>_<filename> — each generation gets
  // its own object so we never accidentally serve a stale cached file.
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
      om_pdf_url: publicUrl,
      om_generated_at: generatedAt,
      updated_at: generatedAt,
    })
    .eq("id", propertyId)
    .eq("organization_id", ORG_ID);

  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: `OM uploaded but failed to persist URL: ${updateErr.message}`, om_pdf_url: publicUrl },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    om_pdf_url: publicUrl,
    filename: result.filename,
    page_count: result.pageCount,
    generated_at: generatedAt,
    storage_path: storagePath,
  });
}
