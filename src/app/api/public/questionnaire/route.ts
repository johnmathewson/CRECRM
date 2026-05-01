/**
 * POST /api/public/questionnaire
 *
 * Receives questionnaire submission from stewardshipcre.com. Creates or
 * upserts a contact, creates a lead row tied to the property, persists the
 * submission for audit, and returns the matching NDA version + a record id
 * the next step (NDA sign) will reference.
 *
 * Public endpoint — middleware doesn't run on /api/*. CORS allowed for
 * marketing site origin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface QuestionnaireBody {
  property_slug: string;
  full_name: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  lead_type: "buyer" | "seller" | "tenant" | "operator" | "investor";
  asset_class_pref?: string;
  budget_range?: string;
  timeline?: string;
  geographic_focus?: string;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const userAgent = req.headers.get("user-agent") || null;

  let body: QuestionnaireBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: corsHeaders(origin) });
  }

  // Validate required fields
  const required: (keyof QuestionnaireBody)[] = ["property_slug", "full_name", "email", "lead_type"];
  for (const f of required) {
    if (!body[f] || (typeof body[f] === "string" && !(body[f] as string).trim())) {
      return NextResponse.json(
        { error: `${f} is required` },
        { status: 400, headers: corsHeaders(origin) }
      );
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400, headers: corsHeaders(origin) });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Look up the property ────────────────────────────────────────────────
  const { data: property } = await supabase
    .from("properties")
    .select("id, name, headline, asset_type")
    .eq("slug", body.property_slug)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!property) {
    return NextResponse.json(
      { error: "Property not found" },
      { status: 404, headers: corsHeaders(origin) }
    );
  }

  // ── Upsert contact by email ─────────────────────────────────────────────
  let contactId: string | null = null;
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("email", body.email.toLowerCase())
    .maybeSingle();

  if (existingContact) {
    contactId = existingContact.id;
    await supabase
      .from("contacts")
      .update({
        full_name: body.full_name.trim(),
        phone: body.phone || undefined,
        relationship_type: "prospect",
        last_conversation: new Date().toISOString().slice(0, 10),
      })
      .eq("id", contactId);
  } else {
    const { data: newContact } = await supabase
      .from("contacts")
      .insert({
        organization_id: ORG_ID,
        full_name: body.full_name.trim(),
        email: body.email.toLowerCase(),
        phone: body.phone || null,
        contact_type: "other",
        relationship_type: "prospect",
        warmth: "warm",
        last_conversation: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    contactId = newContact?.id || null;
  }

  // ── Create a lead row so this surfaces in /inbox alongside email leads ──
  const { data: lead } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: property.id,
      source: "website",
      status: "new",
      sender_name: body.full_name.trim(),
      sender_email: body.email.toLowerCase(),
      sender_phone: body.phone || null,
      property_label: property.headline || property.name,
      intent: body.lead_type === "buyer" || body.lead_type === "investor" || body.lead_type === "operator"
        ? "buy"
        : body.lead_type === "tenant"
        ? "lease"
        : body.lead_type === "seller"
        ? "sell"
        : "info",
      urgency: body.timeline === "Immediate" || body.timeline === "30-90 days" ? "hot" : "warm",
      qualifier_summary: `${body.lead_type} via website questionnaire on ${property.headline || property.name}. ${body.budget_range || ""} ${body.timeline || ""}`.trim(),
      raw_subject: `Inquiry: ${property.headline || property.name}`,
      raw_body: `Submitted via questionnaire form.\n\nLead type: ${body.lead_type}\nCompany: ${body.company || "—"}\nTitle: ${body.title || "—"}\nAsset class: ${body.asset_class_pref || "—"}\nBudget: ${body.budget_range || "—"}\nTimeline: ${body.timeline || "—"}\nGeo: ${body.geographic_focus || "—"}`,
    })
    .select("id")
    .single();

  // ── Persist questionnaire submission ────────────────────────────────────
  const { data: submission, error: subErr } = await supabase
    .from("questionnaire_submissions")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      lead_id: lead?.id || null,
      property_id: property.id,
      full_name: body.full_name.trim(),
      email: body.email.toLowerCase(),
      phone: body.phone || null,
      company: body.company || null,
      title: body.title || null,
      lead_type: body.lead_type,
      asset_class_pref: body.asset_class_pref || null,
      budget_range: body.budget_range || null,
      timeline: body.timeline || null,
      geographic_focus: body.geographic_focus || null,
      raw_payload: body,
      ip_address: ip,
      user_agent: userAgent,
    })
    .select("id")
    .single();

  if (subErr) {
    return NextResponse.json(
      { error: subErr.message },
      { status: 500, headers: corsHeaders(origin) }
    );
  }

  // ── Pick the right NDA version ─────────────────────────────────────────
  // Sellers route directly to John (no vault, no NDA).
  if (body.lead_type === "seller") {
    if (lead?.id) {
      await supabase.from("lead_events").insert({
        organization_id: ORG_ID,
        lead_id: lead.id,
        event_type: "received",
        actor: "system",
        summary: `Seller inquiry via questionnaire — routed direct (no NDA flow)`,
        metadata: { questionnaire_id: submission.id, property_slug: body.property_slug },
      });
    }
    return NextResponse.json(
      {
        submission_id: submission.id,
        property: { id: property.id, slug: body.property_slug, name: property.headline || property.name },
        next_step: "direct_contact",
        message: "Seller inquiries are routed directly. John will reach out personally.",
      },
      { status: 200, headers: corsHeaders(origin) }
    );
  }

  const ndaLeadType = body.lead_type === "tenant" ? "tenant" : "buyer";
  const { data: ndaVersion } = await supabase
    .from("nda_versions")
    .select("id, version, title, body_md")
    .eq("organization_id", ORG_ID)
    .eq("lead_type", ndaLeadType)
    .is("deprecated_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!ndaVersion) {
    return NextResponse.json(
      { error: "No NDA configured for this lead type" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }

  if (lead?.id) {
    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      event_type: "received",
      actor: "system",
      summary: `Questionnaire submitted (${body.lead_type}) — awaiting NDA signature`,
      metadata: { questionnaire_id: submission.id, property_slug: body.property_slug },
    });
  }

  return NextResponse.json(
    {
      submission_id: submission.id,
      property: { id: property.id, slug: body.property_slug, name: property.headline || property.name },
      next_step: "sign_nda",
      nda: {
        version_id: ndaVersion.id,
        version: ndaVersion.version,
        title: ndaVersion.title,
        body_md: ndaVersion.body_md,
        lead_type: ndaLeadType,
      },
    },
    { status: 200, headers: corsHeaders(origin) }
  );
}
