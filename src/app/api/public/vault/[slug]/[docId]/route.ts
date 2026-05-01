/**
 * GET /api/public/vault/[slug]/[docId]?token=<consent_token>
 *
 * Generates a short-lived signed URL for a vault document and 302-redirects
 * the prospect to it. Logs a 'download' access entry. Verifies token →
 * property → doc.category against the prospect's NDA lead_type.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest, { params }: { params: { slug: string; docId: string } }) {
  const origin = req.headers.get("origin");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const userAgent = req.headers.get("user-agent") || null;
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 401, headers: corsHeaders(origin) });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Validate token + load lead_type ────────────────────────────────────
  const { data: sig } = await supabase
    .from("nda_signatures")
    .select(`
      id, contact_id, lead_id, property_id, consent_token_expires_at, revoked_at,
      nda_version:nda_versions(lead_type)
    `)
    .eq("consent_token", token)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!sig || sig.revoked_at || new Date(sig.consent_token_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders(origin) });
  }

  // ── Load the doc ─────────────────────────────────────────────────────
  const { data: doc } = await supabase
    .from("documents")
    .select("id, name, doc_category, file_path, file_type, property_id")
    .eq("id", params.docId)
    .eq("organization_id", ORG_ID)
    .is("deleted_at", null)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404, headers: corsHeaders(origin) });
  }
  if (doc.property_id !== sig.property_id) {
    return NextResponse.json({ error: "Token / property mismatch" }, { status: 403, headers: corsHeaders(origin) });
  }

  // Authorization: tenant tier can see public + tenant; buyer tier can see all.
  const ndaLeadType = (sig.nda_version as any)?.lead_type;
  const allowed =
    doc.doc_category === "public" ||
    (doc.doc_category === "tenant" && (ndaLeadType === "tenant" || ndaLeadType === "buyer")) ||
    (doc.doc_category === "buyer" && ndaLeadType === "buyer");
  if (!allowed) {
    return NextResponse.json(
      { error: "Your NDA tier does not grant access to this document" },
      { status: 403, headers: corsHeaders(origin) }
    );
  }

  // ── Log access ─────────────────────────────────────────────────────────
  await supabase.from("vault_access_logs").insert({
    organization_id: ORG_ID,
    contact_id: sig.contact_id,
    lead_id: sig.lead_id,
    property_id: sig.property_id,
    document_id: doc.id,
    nda_signature_id: sig.id,
    access_type: "download",
    ip_address: ip,
    user_agent: userAgent,
  });

  // ── Generate short-lived signed URL ───────────────────────────────────
  const { data: signed, error: signErr } = await supabase.storage
    .from("vault-documents")
    .createSignedUrl(doc.file_path, 300); // 5 min — enough for the browser to fetch

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message || "Could not create signed URL" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }

  // 302 redirect — browser starts the download from Supabase Storage directly.
  return NextResponse.redirect(signed.signedUrl, 302);
}
