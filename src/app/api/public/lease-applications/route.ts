/**
 * POST /api/public/lease-applications
 *
 * Step 1 of a commercial lease application from stewardshipcre.com.
 * Validates the form, stores it as `pending_upload`, and returns one signed
 * upload URL per attached file plus a one-time finalize token. The browser
 * uploads straight to the private bucket (no Netlify body-size limit, no
 * storage policy for anon), then calls /[id]/finalize — which is where the
 * lead is created.
 *
 * GET returns { ready } so the public form can fall back to email when the
 * service role isn't configured, instead of failing after a long form.
 */

import { NextRequest, NextResponse } from "next/server";
import { corsHeaders } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ENTITY_TYPES,
  LEASE_APP_BUCKET,
  email as cleanEmail,
  longStr,
  money,
  newFinalizeToken,
  parseFiles,
  parseOwners,
  parseReferences,
  safeFileName,
  str,
} from "@/lib/lease-applications";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ ready: !!createAdminClient() }, { headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  const admin = createAdminClient();
  if (!admin) {
    console.error("[lease-applications] SUPABASE_SERVICE_ROLE_KEY is not set — refusing to accept applications");
    return NextResponse.json(
      { error: "Online applications are temporarily unavailable. Please email inquiries@stewardshipcre.com." },
      { status: 503, headers },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });
  }

  // Honeypot — the field is hidden from people; bots fill it.
  if (typeof body.website === "string" && body.website.trim()) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400, headers });
  }

  const businessLegalName = str(body.business_legal_name, 200);
  if (!businessLegalName) return NextResponse.json({ error: "Business legal name is required." }, { status: 400, headers });

  const owners = parseOwners(body.owners);
  if (owners.length === 0) return NextResponse.json({ error: "List at least one owner." }, { status: 400, headers });
  const primary = owners[0];
  const businessEmail = cleanEmail(body.business_email);
  if (!primary.email && !businessEmail) {
    return NextResponse.json({ error: "An email address for the business or first owner is required." }, { status: 400, headers });
  }

  if (body.credit_authorization !== true) {
    return NextResponse.json({ error: "The credit and background authorization must be accepted." }, { status: 400, headers });
  }

  const signatures = Array.isArray(body.signatures)
    ? body.signatures.slice(0, 6).flatMap((s) => {
        const name = s && typeof s === "object" ? str((s as Record<string, unknown>).name, 120) : null;
        return name ? [{ name, signed_at: new Date().toISOString() }] : [];
      })
    : [];
  const guarantorCount = owners.filter((o) => o.guarantor).length;
  if (signatures.length < Math.max(1, guarantorCount)) {
    return NextResponse.json({ error: "Each guarantor must type their name to sign." }, { status: 400, headers });
  }

  const { files, error: fileErr } = parseFiles(body.files);
  if (fileErr) return NextResponse.json({ error: fileErr }, { status: 400, headers });
  if (!files.some((f) => f.doc_type === "photo_id")) {
    return NextResponse.json({ error: "A photo ID for each guarantor is required." }, { status: 400, headers });
  }

  // Property: a listing slug when the form was opened from a listing page,
  // otherwise whatever address the applicant typed.
  let propertyId: string | null = null;
  let propertyLabel = str(body.property_label, 200);
  const slug = str(body.property_slug, 200);
  if (slug) {
    const { data: prop } = await admin
      .from("properties")
      .select("id, name, headline")
      .eq("organization_id", ORG_ID)
      .eq("slug", slug)
      .maybeSingle();
    if (prop) {
      propertyId = prop.id;
      propertyLabel = propertyLabel ?? (prop.headline || prop.name);
    }
  }

  const entityRaw = str(body.entity_type, 40);
  const entityType = entityRaw && (ENTITY_TYPES as readonly string[]).includes(entityRaw) ? entityRaw : null;
  const tenureRaw = str(body.current_tenure, 10);
  const currentTenure = tenureRaw && ["rent", "own", "none"].includes(tenureRaw) ? tenureRaw : null;
  const smsConsent = body.sms_consent === true && !!(primary.phone || str(body.business_phone, 40));

  const { token, hash } = newFinalizeToken();
  const applicationId = crypto.randomUUID();

  const pendingFiles = files.map((f) => ({
    ...f,
    path: `${applicationId}/${crypto.randomUUID()}-${safeFileName(f.file_name)}`,
  }));

  const { error: insErr } = await admin.from("lease_applications").insert({
    id: applicationId,
    organization_id: ORG_ID,
    status: "pending_upload",
    finalize_token_hash: hash,
    pending_files: pendingFiles,
    property_id: propertyId,
    property_label: propertyLabel,
    suite: str(body.suite, 80),
    business_legal_name: businessLegalName,
    dba: str(body.dba, 200),
    intended_use: str(body.intended_use, 300),
    fein: str(body.fein, 20),
    years_in_business: money(body.years_in_business),
    entity_type: entityType,
    entity_type_other: entityType === "other" ? str(body.entity_type_other, 80) : null,
    state_of_formation: str(body.state_of_formation, 40),
    business_address: str(body.business_address, 240),
    business_phone: str(body.business_phone, 40),
    business_email: businessEmail,
    owners,
    current_address: str(body.current_address, 240),
    current_monthly_rent: money(body.current_monthly_rent),
    current_tenure: currentTenure,
    current_landlord: str(body.current_landlord, 160),
    current_landlord_phone: str(body.current_landlord_phone, 40),
    trade_references: parseReferences(body.trade_references),
    monthly_revenue: money(body.monthly_revenue),
    monthly_expenses: money(body.monthly_expenses),
    cash_savings: money(body.cash_savings),
    total_assets: money(body.total_assets),
    total_liabilities: money(body.total_liabilities),
    startup_cost: money(body.startup_cost),
    funding_source: longStr(body.funding_source, 600),
    desired_sf: str(body.desired_sf, 60),
    desired_move_in: str(body.desired_move_in, 60),
    notes: longStr(body.notes, 2000),
    credit_authorization: true,
    signatures,
    sms_consent: smsConsent,
    sms_consent_text: smsConsent ? str(body.sms_consent_text, 600) : null,
    submitter_ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
    user_agent: str(req.headers.get("user-agent"), 400),
  });
  if (insErr) {
    console.error("[lease-applications] insert failed:", insErr.message);
    return NextResponse.json({ error: "Could not save your application. Please try again." }, { status: 500, headers });
  }

  const uploads: Array<{ index: number; path: string; signed_url: string; token: string }> = [];
  for (let i = 0; i < pendingFiles.length; i++) {
    const { data, error } = await admin.storage.from(LEASE_APP_BUCKET).createSignedUploadUrl(pendingFiles[i].path);
    if (error || !data) {
      console.error("[lease-applications] signed upload url failed:", error?.message);
      await admin.from("lease_applications").delete().eq("id", applicationId);
      return NextResponse.json({ error: "Could not prepare file uploads. Please try again." }, { status: 500, headers });
    }
    uploads.push({ index: i, path: data.path, signed_url: data.signedUrl, token: data.token });
  }

  return NextResponse.json(
    { application_id: applicationId, finalize_token: token, uploads },
    { status: 201, headers },
  );
}
