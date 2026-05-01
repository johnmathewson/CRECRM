/**
 * GET /api/public/vault/[slug]?token=<consent_token>
 *
 * Returns the document list a prospect can see for this property given
 * their consent token. Filters by lead_type:
 *   - tenant signature → public + tenant docs
 *   - buyer signature  → public + tenant + buyer docs
 *
 * Logs a 'list_view' access entry on every call.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const origin = req.headers.get("origin");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const userAgent = req.headers.get("user-agent") || null;
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing consent token" }, { status: 401, headers: corsHeaders(origin) });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Validate token ──────────────────────────────────────────────────────
  const { data: sig } = await supabase
    .from("nda_signatures")
    .select(`
      id, contact_id, lead_id, property_id, consent_token_expires_at, revoked_at,
      nda_version:nda_versions(lead_type)
    `)
    .eq("consent_token", token)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!sig || sig.revoked_at) {
    return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401, headers: corsHeaders(origin) });
  }
  if (new Date(sig.consent_token_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Token expired" }, { status: 401, headers: corsHeaders(origin) });
  }

  // ── Find the property ──────────────────────────────────────────────────
  const { data: property } = await supabase
    .from("properties")
    .select("id, name, headline, address, city, state, slug")
    .eq("slug", params.slug)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404, headers: corsHeaders(origin) });
  }
  if (property.id !== sig.property_id) {
    return NextResponse.json(
      { error: "Token is not valid for this property" },
      { status: 403, headers: corsHeaders(origin) }
    );
  }

  // ── Filter docs by lead_type ──────────────────────────────────────────
  const ndaLeadType = (sig.nda_version as any)?.lead_type as "tenant" | "buyer";
  const allowedCategories = ndaLeadType === "buyer" ? ["public", "tenant", "buyer"] : ["public", "tenant"];

  const { data: docs } = await supabase
    .from("documents")
    .select("id, name, doc_category, file_type, file_size_bytes, description, sort_order, created_at")
    .eq("organization_id", ORG_ID)
    .eq("property_id", property.id)
    .in("doc_category", allowedCategories)
    .is("deleted_at", null)
    .order("doc_category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  // ── Log access ─────────────────────────────────────────────────────────
  await supabase.from("vault_access_logs").insert({
    organization_id: ORG_ID,
    contact_id: sig.contact_id,
    lead_id: sig.lead_id,
    property_id: property.id,
    nda_signature_id: sig.id,
    access_type: "list_view",
    ip_address: ip,
    user_agent: userAgent,
  });

  return NextResponse.json(
    {
      property: {
        id: property.id,
        slug: property.slug,
        name: property.name,
        headline: property.headline,
        address: property.address,
        city: property.city,
        state: property.state,
      },
      documents: docs || [],
      access_level: ndaLeadType,
      allowed_categories: allowedCategories,
    },
    { status: 200, headers: corsHeaders(origin) }
  );
}
