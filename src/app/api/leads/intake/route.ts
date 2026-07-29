/**
 * POST /api/leads/intake
 *
 * Public ingress for inbound leads from any channel. Mirrors /api/valuate
 * in being middleware-exempt (Next's matcher already excludes /api/*) and
 * accepts unauthenticated POSTs from Apps Script, Twilio webhooks, the
 * marketing site contact form, etc.
 *
 * Pipeline:
 *   1. Validate payload
 *   2. Dedup against source_message_id
 *   3. Heuristic spam check (cheap)
 *   4. Haiku qualification — extract intent, urgency, sender, property hint
 *   5. Match property against the CRM
 *   6. Upsert contact
 *   7. Insert lead + inbound communication rows
 *   8. Sonnet drafts a substantive reply
 *   9. Save draft, append lead_events
 *  10. Return { lead_id, status, draft_preview }
 *
 * Slice B scope: drafts only — no Gmail send, no auto-ack. The whole point
 * is to validate voice quality on real inbound before adding send-side risk.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";
import { checkSpam } from "@/lib/spam-filter";
import { matchProperty, MATCH_CONFIDENCE_THRESHOLD } from "@/lib/property-match";
import { draftLeadReply } from "@/lib/draft-lead-reply";
import { linkOrphanedComms } from "@/lib/cre-os/send-crm-email";
import { toE164 } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Netlify Pro: up to 60s. Two Claude calls can run long.

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

// ── Types ───────────────────────────────────────────────────────────────────

type LeadSource = "email" | "sms" | "voice" | "website" | "manual_test" | string;

interface IntakeBody {
  source: LeadSource;
  sender_name?: string | null;
  sender_email?: string | null;
  sender_phone?: string | null;
  raw_subject?: string | null;
  raw_body?: string | null;
  raw_payload?: any;
  source_message_id?: string | null;
  /** Attachment metadata from Gmail — stored on the communications row. */
  attachments?: { filename: string; mimeType: string | null; sizeBytes: number | null }[];
}

interface QualificationResult {
  intent: "buy" | "lease" | "sell" | "info" | "other" | null;
  urgency: "hot" | "warm" | "cold";
  sender_name_clean: string | null;
  sender_email_clean: string | null;
  sender_phone_clean: string | null;
  property_label: string | null;
  qualifier_summary: string;
  spam_likelihood: "none" | "low" | "medium" | "high";
  notes: string;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const QUALIFY_SYSTEM = `You are a commercial real estate broker's lead-qualification assistant. You read inbound emails, SMS, and voicemail transcripts and extract structured lead data.

You serve a single broker (John Mathewson, Stewardship CRE, Northwest Indiana / Chicagoland). Inbound usually comes from CREXi, LoopNet, CoStar, the brokerage website, or direct emails about specific listings.

Return ONLY valid JSON matching this exact schema (no markdown, no code fences):
{
  "intent": "buy" | "lease" | "sell" | "info" | "other" | null,
  "urgency": "hot" | "warm" | "cold",
  "sender_name_clean": string | null,
  "sender_email_clean": string | null,
  "sender_phone_clean": string | null,
  "property_label": string | null,
  "qualifier_summary": string,
  "spam_likelihood": "none" | "low" | "medium" | "high",
  "notes": string
}

Field guidance:
- intent: their primary action. "buy" = looking to purchase. "lease" = looking to occupy. "sell" = pitching their own property. "info" = information request, due diligence, generic. "other" = anything else (vendor pitches mark as "other" + spam_likelihood high).
- urgency: "hot" if they explicitly mention a timeline <30 days, name a 1031 exchange, or ask to tour now. "warm" is the default. "cold" if they're clearly browsing or info-gathering.
- sender_name_clean: just the human name, no titles or company tags. Null if you can't tell.
- sender_email_clean / sender_phone_clean: normalized contacts. Null if absent.
- property_label: their reference to the property they're asking about — short, recognizable. Examples: "7880 Broadway", "the Joliet medical building", "the Westville industrial". Null if no clear reference.
- qualifier_summary: ONE sentence with the most important deal qualifiers. Examples: "1031 buyer, $4M cap, 60-day timeline" / "Tenant for 8K SF retail, opening Q3" / "Browsing investor, no urgency stated". Be concrete. Use numbers if the sender gave them.
- spam_likelihood: "high" for SEO/marketing/vendor pitches, lead-gen services, recruitment, "we found your website" cold outreach. "medium" for borderline cases. "low" for unusual but plausible. "none" for clear prospect inquiries.
- notes: brief flag for anything ambiguous, missing, or that John should know before responding.

Be precise. Don't invent details the message doesn't contain.`;

// (DRAFT_SYSTEM_BASE + drafting prompt now live in lib/draft-lead-reply.ts
//  so the questionnaire + CSV-import paths can reuse them.)

// ── Helpers ─────────────────────────────────────────────────────────────────

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Map a lead source onto the communications.channel CHECK vocabulary
 * (email | calendar | sms | phone | voice | website | manual_test).
 *
 * This mapping is load-bearing: we used to insert `channel: body.source`
 * directly, and source='crexi' violated the CHECK — the insert failed
 * silently and 231 CREXi leads ended up with no inbound communications
 * row. Never pass a raw source through as channel.
 */
function channelForSource(source: string): string {
  switch (source) {
    case "email":
      return "email";
    case "sms":
    case "text":
      return "sms";
    case "phone":
    case "call":
      return "phone";
    // CREXi inquiries arrive via the platform — closest bucket is website.
    case "crexi":
    case "website":
    default:
      return "website";
  }
}

async function recordEvent(
  supabase: any,
  leadId: string,
  eventType: string,
  actor: "agent" | "user" | "system",
  summary: string,
  metadata: Record<string, any> = {}
) {
  await supabase.from("lead_events").insert({
    organization_id: ORG_ID,
    lead_id: leadId,
    event_type: eventType,
    actor,
    summary,
    metadata,
  });
}

async function upsertContact(
  supabase: any,
  q: QualificationResult,
  fallbackName: string | null,
  fallbackEmail: string | null,
  fallbackPhone: string | null
): Promise<string | null> {
  const email = q.sender_email_clean || fallbackEmail || null;
  const phone = q.sender_phone_clean || fallbackPhone || null;
  const name = q.sender_name_clean || fallbackName || email || phone || "Unknown lead";

  if (!email && !phone) {
    // Anonymous — create a fresh contact
    const { data, error } = await supabase
      .from("contacts")
      .insert({
        organization_id: ORG_ID,
        full_name: name,
        contact_type: "prospect",
        warmth: q.urgency === "hot" ? "hot" : q.urgency === "cold" ? "cold" : "warm",
        last_conversation: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (error) {
      console.error("Anonymous contact create failed:", error);
      return null;
    }
    return data?.id || null;
  }

  // Look up by email first, then phone
  let existing: any = null;
  if (email) {
    const { data } = await supabase
      .from("contacts")
      .select("id, warmth")
      .eq("organization_id", ORG_ID)
      .ilike("email", email.trim())  // case-insensitive — prevents duplicate contacts
      .maybeSingle();
    if (data) existing = data;
  }
  if (!existing && phone) {
    const { data } = await supabase
      .from("contacts")
      .select("id, warmth")
      .eq("organization_id", ORG_ID)
      .eq("phone", phone)
      .maybeSingle();
    if (data) existing = data;
  }

  if (existing) {
    // Update last_conversation; bump warmth if hot
    const updates: Record<string, any> = {
      last_conversation: new Date().toISOString().slice(0, 10),
    };
    if (q.urgency === "hot" && existing.warmth !== "hot") updates.warmth = "hot";
    await supabase.from("contacts").update(updates).eq("id", existing.id);
    return existing.id;
  }

  // Create new
  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      organization_id: ORG_ID,
      full_name: name,
      email,
      phone,
      contact_type: "other",
      relationship_type: "prospect",
      warmth: q.urgency === "hot" ? "hot" : q.urgency === "cold" ? "cold" : "warm",
      last_conversation: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (error) {
    console.error("Contact create failed:", error);
    return null;
  }
  return created?.id || null;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: IntakeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.source) {
    return NextResponse.json({ error: "source is required" }, { status: 400 });
  }
  if (!body.raw_body && !body.raw_subject) {
    return NextResponse.json({ error: "raw_body or raw_subject required" }, { status: 400 });
  }

  // Every CREXi lead must have an email. CREXi requires a verified email
  // to interact with any listing — anyone on there has one. If we're
  // receiving a CREXi lead without an email, our scraper (browser
  // extension) is dropping the field, and downstream matching then
  // falls back to phone-alone which caused the 2026-07 contacts
  // corruption. Reject at the boundary so bad payloads don't enter the
  // system, and log the reject so we can spot the scraper regressing.
  if (body.source === "crexi") {
    const email = typeof body.sender_email === "string" ? body.sender_email.trim() : "";
    if (!email || !email.includes("@")) {
      console.warn(
        "[leads/intake] Rejected CREXi lead without email — scraper may be dropping the field",
        {
          sender_name: body.sender_name,
          sender_phone: body.sender_phone,
          source_message_id: body.source_message_id,
          raw_body_preview: typeof body.raw_body === "string" ? body.raw_body.slice(0, 200) : null,
        }
      );
      return NextResponse.json(
        {
          error:
            "CREXi lead intake requires sender_email. All CREXi leads have verified emails — " +
            "receiving one without an email indicates the scraper missed it. Reject to prevent " +
            "contact corruption via phone-only matching.",
        },
        { status: 400 }
      );
    }
  }

  const supabase = svc();

  // ── 0. Dedup by source_message_id ─────────────────────────────────────────
  if (body.source_message_id) {
    const { data: existing } = await supabase
      .from("communications")
      .select("id, lead_id")
      .eq("external_id", body.source_message_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { lead_id: existing.lead_id, status: "duplicate", message: "Already processed" },
        { status: 200 }
      );
    }
  }

  // Phones are stored E.164 (+1XXXXXXXXXX) everywhere — the SMS/voice
  // webhooks match on exact strings, and mixed formats ("610.416.1341")
  // split one person's thread into phantom leads (Arjun, 7/29).
  if (body.sender_phone) body.sender_phone = toE164(body.sender_phone) ?? body.sender_phone;

  // ── 1. Heuristic spam check ───────────────────────────────────────────────
  const spamCheck = checkSpam({
    sender_email: body.sender_email,
    sender_name: body.sender_name,
    subject: body.raw_subject,
    body: body.raw_body,
  });

  // For hard spam: still create a lead row so John has a record + can audit,
  // but skip qualification + drafting.
  if (spamCheck.verdict === "spam") {
    const { data: lead } = await supabase
      .from("leads")
      .insert({
        organization_id: ORG_ID,
        source: body.source,
        status: "spam",
        sender_name: body.sender_name,
        sender_email: body.sender_email,
        sender_phone: body.sender_phone,
        raw_subject: body.raw_subject,
        raw_body: body.raw_body,
        urgency: "cold",
      })
      .select("id")
      .single();
    if (lead) {
      await recordEvent(supabase, lead.id, "spam_flagged", "agent", spamCheck.reasons.join("; "), {
        verdict: "spam",
        reasons: spamCheck.reasons,
      });
      const { error: commErr } = await supabase.from("communications").insert({
        organization_id: ORG_ID,
        lead_id: lead.id,
        channel: channelForSource(body.source),
        direction: "inbound",
        external_id: body.source_message_id || null,
        subject: body.raw_subject || null,
        body_preview: (body.raw_body || "").slice(0, 500),
        from_address: body.sender_email || body.sender_phone || null,
        occurred_at: new Date().toISOString(),
        attachments: body.attachments ?? [],
        raw_payload: { ...(body.raw_payload || {}), lead_source: body.source },
      });
      if (commErr) {
        console.error("[leads/intake] spam comm insert failed:", commErr.message);
      }
    }
    return NextResponse.json({
      lead_id: lead?.id || null,
      status: "spam",
      reason: spamCheck.reasons[0],
    });
  }

  // ── 2. Haiku qualification ────────────────────────────────────────────────
  const qualifyMessage = `Inbound channel: ${body.source}
${body.sender_name ? `Sender name: ${body.sender_name}\n` : ""}${body.sender_email ? `Sender email: ${body.sender_email}\n` : ""}${body.sender_phone ? `Sender phone: ${body.sender_phone}\n` : ""}Subject: ${body.raw_subject || "(none)"}

Body:
${body.raw_body || "(empty)"}`;

  let qualification: QualificationResult;
  let qualifyTokens: any = null;
  try {
    const result = await callAnthropic({
      model: MODELS.HAIKU,
      system: QUALIFY_SYSTEM,
      messages: [{ role: "user", content: qualifyMessage }],
      maxTokens: 1024,
      temperature: 0.2,
    });
    qualifyTokens = result.usage;
    const parsed = parseJsonResponse<QualificationResult>(result.text);
    if (!parsed) throw new Error("Could not parse qualification JSON");
    qualification = parsed;
    // Haiku's "clean" phone is free-form — force E.164 like every other path.
    if (qualification.sender_phone_clean) {
      qualification.sender_phone_clean =
        toE164(qualification.sender_phone_clean) ?? qualification.sender_phone_clean;
    }
  } catch (err: any) {
    console.error("Qualification failed:", err);
    return NextResponse.json(
      { error: `Qualification failed: ${err.message}` },
      { status: 502 }
    );
  }

  // Promote borderline-spam to spam-flagged if Haiku also thinks it's bad
  const isLikelySpam =
    qualification.spam_likelihood === "high" ||
    (spamCheck.verdict === "borderline" && qualification.spam_likelihood === "medium");

  // ── 3. Property match ─────────────────────────────────────────────────────
  const matchResult = await matchProperty(supabase, ORG_ID, {
    raw_subject: body.raw_subject,
    raw_body: body.raw_body,
    property_label: qualification.property_label,
  });
  const matched = matchResult.confidence >= MATCH_CONFIDENCE_THRESHOLD ? matchResult.property : null;

  // ── 4. Contact upsert ────────────────────────────────────────────────────
  const contactId = await upsertContact(
    supabase,
    qualification,
    body.sender_name || null,
    body.sender_email || null,
    body.sender_phone || null
  );

  // ── 4b. Thread repeat inquiries into the existing open lead ──────────────
  // Same person + same property (or both property-less) within 30 days is a
  // continuation of ONE conversation, not a new lead. Without this, every
  // repeat submission minted a sibling lead (Kamini Patel accumulated five)
  // and the person's thread got scattered across lead files. Same 30-day
  // window rule as the SMS webhook.
  const threadEmail = qualification.sender_email_clean || body.sender_email || null;
  if (threadEmail && !isLikelySpam) {
    let threadQuery = supabase
      .from("leads")
      .select("id, raw_body, status")
      .eq("organization_id", ORG_ID)
      .ilike("sender_email", threadEmail.trim())
      .not("status", "in", '("archived","spam")')
      .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    threadQuery = matched
      ? threadQuery.eq("property_id", matched.id)
      : threadQuery.is("property_id", null);
    const { data: openLeads } = await threadQuery;
    const openLead = (openLeads ?? [])[0] ?? null;

    if (openLead) {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
      const entry = `[repeat inquiry ${stamp}] ${body.raw_subject || ""}\n${body.raw_body || ""}`.trim();
      await supabase
        .from("leads")
        .update({
          raw_body: openLead.raw_body ? `${openLead.raw_body}\n\n${entry}` : entry,
          // They reached out again — back into the queue even if previously
          // replied ('sent') or contacted.
          status: "new",
          urgency: qualification.urgency,
          qualifier_summary: qualification.qualifier_summary,
          ...(contactId ? { contact_id: contactId } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", openLead.id);

      const { error: threadCommErr } = await supabase.from("communications").insert({
        organization_id: ORG_ID,
        lead_id: openLead.id,
        contact_id: contactId,
        channel: channelForSource(body.source),
        direction: "inbound",
        external_id: body.source_message_id || null,
        subject: body.raw_subject || null,
        body_preview: (body.raw_body || "").slice(0, 500),
        from_address: body.sender_email || body.sender_phone || null,
        occurred_at: new Date().toISOString(),
        attachments: body.attachments ?? [],
        raw_payload: { ...(body.raw_payload || {}), lead_source: body.source, repeat_inquiry: true },
      });
      if (threadCommErr) {
        console.error("[leads/intake] threaded comm insert failed:", threadCommErr.message);
      }

      await recordEvent(
        supabase,
        openLead.id,
        "received",
        "system",
        `Repeat inquiry via ${body.source} — threaded into existing lead (was '${openLead.status}')`,
        { source: body.source, source_message_id: body.source_message_id }
      );

      // No auto-ack on repeat inquiries — the receipt is a first-touch-only
      // courtesy. The drafter self-skips if a reply was already sent; the
      // reply bar's regenerate button covers fresh drafts on demand.
      return NextResponse.json({
        lead_id: openLead.id,
        status: "threaded",
        qualification,
        matched_property: matched
          ? { id: matched.id, name: matched.name, slug: matched.slug }
          : null,
      });
    }
  }

  // ── 5. Insert lead row ────────────────────────────────────────────────────
  const status = isLikelySpam ? "spam" : matched ? "new" : "unmatched";

  const { data: leadInsert, error: leadErr } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: matched?.id || null,
      source: body.source,
      status,
      sender_name: qualification.sender_name_clean || body.sender_name,
      sender_email: qualification.sender_email_clean || body.sender_email,
      sender_phone: qualification.sender_phone_clean || body.sender_phone,
      property_label: qualification.property_label,
      intent: qualification.intent,
      urgency: qualification.urgency,
      qualifier_summary: qualification.qualifier_summary,
      raw_subject: body.raw_subject,
      raw_body: body.raw_body,
      claude_extraction: qualification,
    })
    .select("id")
    .single();

  if (leadErr || !leadInsert) {
    console.error("Lead insert failed:", leadErr);
    return NextResponse.json(
      { error: `Lead persist failed: ${leadErr?.message}` },
      { status: 500 }
    );
  }
  const leadId = leadInsert.id;

  // ── 5b. Link orphaned communications for this sender ─────────────────────
  // Any outbound rows (bulk-AI, cadence, lane-touch) sent to this email before
  // the leads row existed will have lead_id=null. Link them now so they surface
  // in the ContactDrawer thread immediately.
  const resolvedSenderEmail =
    qualification.sender_email_clean || body.sender_email || null;
  await linkOrphanedComms(supabase, leadId, resolvedSenderEmail, matched?.id ?? null);

  // ── 6. Inbound communication ─────────────────────────────────────────────
  const { error: commErr } = await supabase.from("communications").insert({
    organization_id: ORG_ID,
    lead_id: leadId,
    contact_id: contactId,
    channel: channelForSource(body.source),
    direction: "inbound",
    external_id: body.source_message_id || null,
    subject: body.raw_subject || null,
    body_preview: (body.raw_body || "").slice(0, 500),
    from_address: body.sender_email || body.sender_phone || null,
    occurred_at: new Date().toISOString(),
    attachments: body.attachments ?? [],
    raw_payload: { ...(body.raw_payload || {}), lead_source: body.source },
  });
  if (commErr) {
    // Loud, not silent — a missing comm row is exactly the kind of gap the
    // coverage check exists to catch.
    console.error("[leads/intake] comm insert failed:", commErr.message);
  }

  // ── 7. Events: received + qualified + match outcome ──────────────────────
  await recordEvent(
    supabase,
    leadId,
    "received",
    "system",
    `Inbound from ${body.source}${qualification.sender_name_clean ? ` — ${qualification.sender_name_clean}` : ""}`,
    { source: body.source, source_message_id: body.source_message_id }
  );
  await recordEvent(
    supabase,
    leadId,
    "qualified",
    "agent",
    qualification.qualifier_summary,
    {
      intent: qualification.intent,
      urgency: qualification.urgency,
      spam_likelihood: qualification.spam_likelihood,
      notes: qualification.notes,
      model: MODELS.HAIKU,
      tokens: qualifyTokens,
    }
  );

  if (matched) {
    await recordEvent(
      supabase,
      leadId,
      "matched_property",
      "agent",
      `Matched ${matched.name || matched.address} (confidence ${(matchResult.confidence * 100).toFixed(0)}%)`,
      { property_id: matched.id, confidence: matchResult.confidence, reasons: matchResult.reasons }
    );
  } else {
    await recordEvent(
      supabase,
      leadId,
      "unmatched",
      "agent",
      qualification.property_label
        ? `No CRM property matches "${qualification.property_label}" — flagged for review`
        : "No property reference found in inbound",
      { hint: qualification.property_label, best_score: matchResult.confidence }
    );
  }

  if (isLikelySpam) {
    await recordEvent(
      supabase,
      leadId,
      "spam_flagged",
      "agent",
      `Haiku flagged as spam (${qualification.spam_likelihood} likelihood)`,
      { spam_likelihood: qualification.spam_likelihood }
    );
    return NextResponse.json({
      lead_id: leadId,
      status: "spam",
      qualification,
    });
  }

  // ── 8. Hand off to shared drafter (loads intel + Sonnet + saves draft) ───
  const draftOutcome = await draftLeadReply({
    supabase,
    organizationId: ORG_ID,
    leadId,
    tone: "first_touch",
  });

  if (!draftOutcome.ok) {
    // Lead is saved + qualified; drafter just couldn't produce copy.
    return NextResponse.json({
      lead_id: leadId,
      status,
      qualification,
      matched_property: matched ? { id: matched.id, name: matched.name } : null,
      draft_reply: null,
      draft_error: draftOutcome.error || draftOutcome.skipped || "unknown",
    });
  }
  const draftReply = draftOutcome.draft || null;

  // ── 11. Schedule auto-acknowledgment (Slice C) ───────────────────────────
  // Conditions per the blueprint:
  //   - Real channel (not manual test seeds — those use fake emails)
  //   - Status 'new' (matched, not spam, not unmatched)
  //   - We have an email to send to
  //   - Brand-new contact (no prior history) OR new property thread
  //   - Auto-ack hasn't already been queued
  const eligibleSource = body.source !== "manual_test";
  const eligibleStatus = status === "new";
  const hasEmail = !!(qualification.sender_email_clean || body.sender_email);

  // Fresh-contact check: do they have any other prior leads in the CRM?
  // (Cheaper than calling gatherIntel a second time just for this signal.)
  let isFreshContact = true;
  if (contactId) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .eq("contact_id", contactId)
      .neq("id", leadId);
    isFreshContact = (count || 0) === 0;
  }

  if (eligibleSource && eligibleStatus && hasEmail && isFreshContact) {
    // Random delay 2-5 minutes for the humanizing pause
    const delayMs = (2 + Math.random() * 3) * 60 * 1000;
    const sendAfter = new Date(Date.now() + delayMs).toISOString();

    const { error: schedErr } = await supabase.from("scheduled_acks").insert({
      organization_id: ORG_ID,
      lead_id: leadId,
      send_after: sendAfter,
    });

    if (!schedErr) {
      await recordEvent(
        supabase,
        leadId,
        "qualified",
        "system",
        `Auto-ack scheduled for ${new Date(sendAfter).toLocaleTimeString()}`,
        { send_after: sendAfter, delay_seconds: Math.round(delayMs / 1000) }
      );
    }
  }

  return NextResponse.json({
    lead_id: leadId,
    status,
    qualification,
    matched_property: matched
      ? { id: matched.id, name: matched.name, slug: matched.slug }
      : null,
    draft_reply: draftReply,
  });
}
