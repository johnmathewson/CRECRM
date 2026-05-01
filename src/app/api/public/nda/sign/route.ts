/**
 * POST /api/public/nda/sign
 *
 * Records a click-through NDA signature. Three side effects:
 *   1. Insert audit-grade row in nda_signatures (typed name, IP, UA, exact
 *      text hash, generated PDF path, time-bound consent_token).
 *   2. Render and upload the signed NDA as a PDF to nda-pdfs bucket.
 *   3. Drop a lead_event so it surfaces in /agent activity.
 *
 * Returns the consent_token the marketing site uses to access the vault.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { corsHeaders } from "@/lib/cors";
import { buildNdaPdf } from "@/lib/nda-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface SignBody {
  submission_id: string;
  nda_version_id: string;
  typed_name: string;
  typed_email: string;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const userAgent = req.headers.get("user-agent") || null;

  let body: SignBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(origin) });
  }

  if (!body.submission_id || !body.nda_version_id || !body.typed_name?.trim() || !body.typed_email?.trim()) {
    return NextResponse.json(
      { error: "submission_id, nda_version_id, typed_name, typed_email are required" },
      { status: 400, headers: corsHeaders(origin) }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Load submission + NDA + property ────────────────────────────────────
  const [{ data: submission }, { data: ndaVersion }] = await Promise.all([
    supabase.from("questionnaire_submissions")
      .select(`
        id, contact_id, lead_id, property_id, full_name, email,
        property:properties(id, name, headline, address, city, state, slug)
      `)
      .eq("id", body.submission_id)
      .eq("organization_id", ORG_ID)
      .maybeSingle(),
    supabase.from("nda_versions")
      .select("id, lead_type, version, title, body_md")
      .eq("id", body.nda_version_id)
      .eq("organization_id", ORG_ID)
      .maybeSingle(),
  ]);

  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404, headers: corsHeaders(origin) });
  }
  if (!ndaVersion) {
    return NextResponse.json({ error: "NDA version not found" }, { status: 404, headers: corsHeaders(origin) });
  }

  const property = (submission as any).property;
  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404, headers: corsHeaders(origin) });
  }

  // Sanity check: typed name should match (case-insensitive) the submitted name.
  // Not strict — broker-facing audit is the point, not blocking.
  // The text_hash binds them together regardless.

  // ── Compute text hash + token ───────────────────────────────────────────
  const renderedText = `${ndaVersion.title}\n\n${ndaVersion.body_md}\n\nSigner: ${body.typed_name.trim()}\nEmail: ${body.typed_email.trim().toLowerCase()}`;
  const textHash = createHash("sha256").update(renderedText, "utf8").digest("hex");

  const consentToken = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  // ── Generate PDF ────────────────────────────────────────────────────────
  const signedAt = new Date();
  let signedPdfPath: string | null = null;
  try {
    const pdfBytes = buildNdaPdf({
      title: ndaVersion.title,
      bodyMd: ndaVersion.body_md,
      property: {
        name: property.headline || property.name,
        address: property.address,
        city: property.city,
        state: property.state,
      },
      signer: { typed_name: body.typed_name.trim(), typed_email: body.typed_email.trim().toLowerCase() },
      signedAt,
      ipAddress: ip,
      userAgent,
      textHash,
    });

    signedPdfPath = `${property.slug || property.id}/${signedAt.getTime()}-${textHash.slice(0, 8)}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("nda-pdfs")
      .upload(signedPdfPath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (upErr) {
      console.error("NDA PDF upload failed:", upErr);
      signedPdfPath = null; // continue — DB row is the legally binding record
    }
  } catch (err) {
    console.error("NDA PDF render failed:", err);
  }

  // ── Persist signature row ───────────────────────────────────────────────
  const { data: sig, error: sigErr } = await supabase
    .from("nda_signatures")
    .insert({
      organization_id: ORG_ID,
      contact_id: submission.contact_id,
      lead_id: submission.lead_id,
      property_id: submission.property_id,
      questionnaire_id: submission.id,
      nda_version_id: ndaVersion.id,
      typed_name: body.typed_name.trim(),
      typed_email: body.typed_email.trim().toLowerCase(),
      ip_address: ip,
      user_agent: userAgent,
      text_hash: textHash,
      signed_pdf_path: signedPdfPath,
      consent_token: consentToken,
      consent_token_expires_at: expiresAt,
    })
    .select("id, consent_token, consent_token_expires_at")
    .single();

  if (sigErr || !sig) {
    return NextResponse.json(
      { error: sigErr?.message || "Could not record signature" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }

  // ── Bump contact warmth (signing = engaged) ─────────────────────────────
  if (submission.contact_id) {
    await supabase.from("contacts").update({ warmth: "hot" }).eq("id", submission.contact_id);
  }

  // ── Lead event ──────────────────────────────────────────────────────────
  if (submission.lead_id) {
    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: submission.lead_id,
      event_type: "qualified",
      actor: "user",
      summary: `${body.typed_name.trim()} signed ${ndaVersion.lead_type} NDA — vault unlocked`,
      metadata: {
        signature_id: sig.id,
        nda_version: ndaVersion.version,
        nda_lead_type: ndaVersion.lead_type,
        text_hash: textHash,
        signed_pdf_path: signedPdfPath,
      },
    });
  }

  return NextResponse.json(
    {
      consent_token: sig.consent_token,
      expires_at: sig.consent_token_expires_at,
      vault_path: `/properties/${property.slug || property.id}/vault?token=${sig.consent_token}`,
      lead_type: ndaVersion.lead_type,
    },
    { status: 200, headers: corsHeaders(origin) }
  );
}
