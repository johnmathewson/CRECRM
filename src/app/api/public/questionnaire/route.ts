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
import { draftLeadReply } from "@/lib/draft-lead-reply";
import { toE164 } from "@/lib/twilio";
import { resolveParty, recordTouch, alarm } from "@/lib/cre-os/record-touch";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Sonnet drafting can be slow

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

  // Phones are stored E.164 everywhere — mixed formats split SMS threads.
  if (body.phone) body.phone = toE164(body.phone) ?? body.phone;

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

  // ── Resolve the person by email ─────────────────────────────────────────
  // resolveParty is FILL-ONLY on a match. This is an unauthenticated public
  // form: it may add a missing phone or name, but it must never overwrite
  // curated data — anyone who knew a client's email could rewrite that
  // client's record.
  let contactId: string;
  try {
    contactId = (
      await resolveParty(supabase, {
        email: body.email,
        phone: body.phone || null,
        name: body.full_name,
        company: body.company || null,
        source: "questionnaire",
      })
    ).contactId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await alarm(supabase, "questionnaire_no_party", message, { email: body.email, property: body.property_slug });
    return NextResponse.json({ error: "Could not save your details — please try again." }, { status: 500, headers: corsHeaders(origin) });
  }

  // ── Thread repeat submissions into the existing open lead ───────────────
  // ONE open lead per person per property (DB-enforced, migration 0035).
  // A returning person re-submitting the form for the SAME property never
  // mints a sibling lead (Kamini Patel accumulated five this way — her
  // conversation got scattered across lead files). A different property
  // still gets its own lead.
  const findOpenLead = async () => {
    const { data } = await supabase
      .from("leads")
      .select("id, raw_body, status")
      .eq("organization_id", ORG_ID)
      .eq("contact_id", contactId)
      .eq("property_id", property.id)
      .not("status", "in", '("archived","spam","converted","promoted","dead")')
      .order("created_at", { ascending: false })
      .limit(1);
    return ((data ?? [])[0] ?? null) as { id: string; raw_body: string | null; status: string | null } | null;
  };
  let openLead = await findOpenLead();

  if (openLead) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
    const entry =
      `[repeat questionnaire ${stamp}] Lead type: ${body.lead_type} · Budget: ${body.budget_range || "—"} · Timeline: ${body.timeline || "—"} · Company: ${body.company || "—"}`;
    await supabase
      .from("leads")
      .update({
        raw_body: openLead.raw_body ? `${openLead.raw_body}\n\n${entry}` : entry,
        status: "new", // they reached out again — back into the queue
        updated_at: new Date().toISOString(),
      })
      .eq("id", openLead.id);
  }

  // ── Create a lead row so this surfaces in /inbox alongside email leads ──
  let lead: { id: string } | null = openLead ? { id: openLead.id } : null;
  let leadErr: { code?: string; message: string } | null = null;
  if (!lead) {
    const res = await supabase
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
    lead = res.data ?? null;
    leadErr = res.error ?? null;
    if (leadErr?.code === "23505") {
      // Lost a race with a concurrent submission for the same person+property.
      openLead = await findOpenLead();
      if (openLead) {
        lead = { id: openLead.id };
        leadErr = null;
      }
    }
    if (leadErr || !lead) {
      await alarm(supabase, "questionnaire_lead_insert", leadErr?.message ?? "no row returned", {
        email: body.email,
        property: body.property_slug,
        contact_id: contactId,
      });
      return NextResponse.json({ error: "Could not save your inquiry — please try again." }, { status: 500, headers: corsHeaders(origin) });
    }
  }
  const isNewLead = !openLead;

  // ── Schedule the 60-second auto-receipt (first touch only) ─────────────
  // Email intake schedules this; the website form never did, so form leads
  // waited for John's hand-written reply with no receipt at all. Drained by
  // poll-gmail Job 2 → /api/leads/[id]/ack.
  if (isNewLead) {
    const delayMs = (2 + Math.random() * 3) * 60 * 1000;
    const { error: schedErr } = await supabase.from("scheduled_acks").insert({
      organization_id: ORG_ID,
      lead_id: lead.id,
      send_after: new Date(Date.now() + delayMs).toISOString(),
    });
    if (schedErr) {
      await alarm(supabase, "ack_not_scheduled", `Website lead ${lead.id} has no auto-ack scheduled: ${schedErr.message}`, { lead_id: lead.id });
    }
  }

  // ── Mirror into communications ──────────────────────────────────────────
  // Every inbound expression of interest gets a communications row — the
  // comms dashboard + coverage check treat that table as the universal log.
  if (lead?.id) {
    try {
      await recordTouch(supabase, {
        channel: "website",
        direction: "inbound",
        contactId,
        leadId: lead.id,
        propertyId: property.id,
        subject: `Inquiry: ${property.headline || property.name}`,
        body:
          `${body.lead_type} via questionnaire. ` +
          `Budget: ${body.budget_range || "—"} · Timeline: ${body.timeline || "—"} · Company: ${body.company || "—"}`,
        fromAddress: body.email.toLowerCase(),
        source: "questionnaire",
        rawPayload: { lead_type: body.lead_type },
      });
    } catch (err) {
      await alarm(supabase, "questionnaire_comm_insert", err instanceof Error ? err.message : String(err), { lead_id: lead.id });
    }
  }

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
      // Fire drafter in background — sellers also get a personalized reply.
      void draftLeadReply({
        supabase,
        organizationId: ORG_ID,
        leadId: lead.id,
        tone: "first_touch",
      }).catch((err: unknown) => {
        console.error(
          "[questionnaire] seller draftLeadReply failed for lead",
          lead.id,
          err instanceof Error ? err.message : err
        );
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

    // Fire the drafter in the background so the agent has a substantive
    // reply waiting in /inbox by the time John sees the lead. We don't
    // await — questionnaire response goes back to the user immediately.
    void draftLeadReply({
      supabase,
      organizationId: ORG_ID,
      leadId: lead.id,
      tone: "first_touch",
    }).catch((err: unknown) => {
      console.error(
        "[questionnaire] draftLeadReply failed for lead",
        lead.id,
        err instanceof Error ? err.message : err
      );
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
