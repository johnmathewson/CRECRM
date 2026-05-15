/**
 * POST /api/leads/bulk-ai-followup
 *
 * Bulk send AI-personalized follow-up emails to a list of warm leads on
 * a specific property. Each recipient gets a uniquely written message
 * grounded in their actual engagement (NDA signed, OM downloaded, visits)
 * and the property's specifics (asset class, sqft, cap rate, etc.).
 *
 * Cross-references existing outbound communications: any lead who got an
 * outbound email in the lookback window is SKIPPED (no double-touching).
 *
 * Body:
 *   {
 *     propertyId: string                 (required)
 *     leadIds: string[]                  (required — crexi_leads_state IDs or leads.id)
 *     dryRun?: boolean                   (default false)
 *     skipIfTouchedWithinDays?: number   (default 7)
 *   }
 *
 * Returns:
 *   {
 *     ok: true,
 *     attempted: N,
 *     sent: N,
 *     skipped: [{ leadId, reason }],
 *     failed: [{ leadId, error }],
 *     results: [{ leadId, email, messageId, threadId }]
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { sendMessage } from "@/lib/gmail";
import {
  personalizeTouch,
  archetypeFromContext,
  DEFAULT_SENDER,
} from "@/lib/cre-os/ai-touch-personalize";
import { captureVoiceExample } from "@/lib/cre-os/voice-examples";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const SEND_DISPLAY_NAME = "John Mathewson";

interface Body {
  propertyId: string;
  leadIds: string[];
  dryRun?: boolean;
  skipIfTouchedWithinDays?: number;
}

interface CrexiLeadRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  level_of_interest: string | null;
  number_of_visits: number | null;
  last_activity_date: string | null;
}

interface DirectLeadRow {
  id: string;
  sender_name: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  urgency: string | null;
  created_at: string;
  qualifier_summary: string | null;
}

interface SkipReason {
  leadId: string;
  email: string | null;
  reason: string;
}

interface FailedRow {
  leadId: string;
  email: string | null;
  error: string;
}

interface SentRow {
  leadId: string;
  email: string;
  messageId: string;
  threadId: string;
  /** Populated on dry-run (and real sends) so the UI can preview tone */
  subject?: string;
  body?: string;
  rationale?: string;
  /** Recipient name — for the preview header */
  recipientName?: string | null;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds required (non-empty array)" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Load property ────────────────────────────────────────────────────
  const { data: prop } = await supabase
    .from("properties")
    .select(`
      id, name, address, city, state, asset_type, sub_type, sqft, units,
      year_built, cap_rate, building_class, submarket, for_sale_status,
      years_owned, last_sale_price, mortgage_maturity_date, mortgage_lender,
      estimated_value, owner_name_raw, marketing_notes, document_inventory
    `)
    .eq("organization_id", ORG_ID)
    .eq("id", body.propertyId)
    .maybeSingle();
  if (!prop) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  // ── Resolve leads — try crexi_leads_state first, then leads table ────
  // Caller passes either a crexi_leads_state.id or a leads.id; we handle both.
  const { data: crexiRows } = await supabase
    .from("crexi_leads_state")
    .select("id, name, email, phone, company, role, level_of_interest, number_of_visits, last_activity_date")
    .eq("organization_id", ORG_ID)
    .eq("property_id", body.propertyId)
    .in("id", body.leadIds);

  const foundCrexi = (crexiRows ?? []) as CrexiLeadRow[];
  const foundCrexiIds = new Set(foundCrexi.map((r) => r.id));
  const remainingIds = body.leadIds.filter((id) => !foundCrexiIds.has(id) && !id.startsWith("nda-"));

  const { data: directRows } = remainingIds.length > 0
    ? await supabase
        .from("leads")
        .select("id, sender_name, sender_email, sender_phone, urgency, created_at, qualifier_summary")
        .eq("organization_id", ORG_ID)
        .eq("property_id", body.propertyId)
        .in("id", remainingIds)
    : { data: [] };
  const foundDirect = (directRows ?? []) as DirectLeadRow[];

  // ── Pull recent outbound communications for double-touch check ───────
  // CRITICAL: this is ORG-WIDE, not per-property. The same person may appear
  // as a lead on multiple listings (e.g. a broker who looked at Liberty
  // Square AND Super 8). If we sent them an email about Liberty yesterday,
  // we cannot send them an email about Super 8 today — that's a brand
  // killer. Skip anyone who got ANY of our outbound in the last N days,
  // regardless of which property triggered it.
  const skipDays = body.skipIfTouchedWithinDays ?? 7;
  const cutoff = new Date(Date.now() - skipDays * 86400_000).toISOString();
  const [{ data: recentCommsOut }, { data: recentLaneSends }] = await Promise.all([
    // Source 1: communications (the bulk-followup path, send-reply path)
    supabase
      .from("communications")
      .select("to_addresses, occurred_at, property_id")
      .eq("organization_id", ORG_ID)
      .eq("direction", "outbound")
      .gte("occurred_at", cutoff),
    // Source 2: lane_touches (the Compose path historically, now dual-written
    // but still query both for safety across the transition window)
    supabase
      .from("lane_touches")
      .select("metadata, sent_at, property_id")
      .eq("organization_id", ORG_ID)
      .eq("status", "sent")
      .gte("sent_at", cutoff),
  ]);

  // Build: email -> { whenTouched, whichPropertyId }. Newest wins.
  const touchedEmailToProperty = new Map<string, { at: string; propertyId: string | null }>();
  for (const c of (recentCommsOut ?? []) as Array<{ to_addresses: string[] | null; occurred_at: string; property_id: string | null }>) {
    for (const a of c.to_addresses ?? []) {
      const e = a.toLowerCase().trim();
      const prev = touchedEmailToProperty.get(e);
      if (!prev || c.occurred_at > prev.at) {
        touchedEmailToProperty.set(e, { at: c.occurred_at, propertyId: c.property_id });
      }
    }
  }
  for (const t of (recentLaneSends ?? []) as Array<{ metadata: Record<string, unknown> | null; sent_at: string | null; property_id: string | null }>) {
    const toEmail = ((t.metadata?.to as string) ?? "").toLowerCase().trim();
    if (!toEmail || !t.sent_at) continue;
    const prev = touchedEmailToProperty.get(toEmail);
    if (!prev || t.sent_at > prev.at) {
      touchedEmailToProperty.set(toEmail, { at: t.sent_at, propertyId: t.property_id });
    }
  }
  const touchedEmails = new Set(Array.from(touchedEmailToProperty.keys()));

  // Resolve property_id → name for nicer skip-reason messages
  const otherPropertyIds = new Set<string>();
  Array.from(touchedEmailToProperty.values()).forEach((v) => {
    if (v.propertyId && v.propertyId !== body.propertyId) otherPropertyIds.add(v.propertyId);
  });
  const propertyNamesById = new Map<string, string>();
  if (otherPropertyIds.size > 0) {
    const { data: propNames } = await supabase
      .from("properties")
      .select("id, name")
      .in("id", Array.from(otherPropertyIds));
    for (const p of (propNames ?? []) as Array<{ id: string; name: string }>) {
      propertyNamesById.set(p.id, p.name);
    }
  }

  // ── Opt-outs (CAN-SPAM) ──────────────────────────────────────────────
  // Anyone in email_optouts is excluded unconditionally. Lower-cased + trimmed
  // for case-insensitive matching against the unique index.
  const { data: optoutsData } = await supabase
    .from("email_optouts")
    .select("email")
    .eq("organization_id", ORG_ID);
  const optouts = new Set<string>(
    ((optoutsData ?? []) as Array<{ email: string }>).map((o) => o.email.toLowerCase().trim())
  );

  // ── Daily send cap (defensive) ────────────────────────────────────────
  // Read the org's daily cap from broker_voice_profile, then count today's
  // outbound communications. Anything over the cap is queued / skipped.
  const { data: voiceRow } = await supabase
    .from("broker_voice_profile")
    .select("daily_send_cap")
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  const dailyCap = (voiceRow?.daily_send_cap as number) ?? 100;
  const startOfDayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const { count: sentTodayCount } = await supabase
    .from("communications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("direction", "outbound")
    .gte("occurred_at", startOfDayIso);
  let remainingDailyBudget = Math.max(0, dailyCap - (sentTodayCount ?? 0));

  // ── Gmail token ──────────────────────────────────────────────────────
  let gmailToken;
  if (!body.dryRun) {
    try {
      gmailToken = await getActiveGmailToken(supabase);
    } catch (err) {
      return NextResponse.json(
        { error: `Gmail token refresh failed: ${err instanceof Error ? err.message : err}` },
        { status: 500 }
      );
    }
    if (!gmailToken) {
      return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });
    }
  }

  const sent: SentRow[] = [];
  const skipped: SkipReason[] = [];
  const failed: FailedRow[] = [];

  // Unified loop over both lead sources
  type UnifiedLead = {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    role: string | null;
    levelOfInterest: string | null;
    visitCount: number | null;
    lastActivityDate: string | null;
  };
  const unified: UnifiedLead[] = [
    ...foundCrexi.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      company: r.company,
      role: r.role,
      levelOfInterest: r.level_of_interest,
      visitCount: r.number_of_visits,
      lastActivityDate: r.last_activity_date,
    })),
    ...foundDirect.map((r) => ({
      id: r.id,
      name: r.sender_name,
      email: r.sender_email,
      phone: r.sender_phone,
      company: null,
      role: null,
      levelOfInterest: r.qualifier_summary,
      visitCount: null,
      lastActivityDate: r.created_at,
    })),
  ];

  for (const lead of unified) {
    // Skip: no email
    if (!lead.email) {
      skipped.push({ leadId: lead.id, email: null, reason: "no email on file" });
      continue;
    }
    // Skip: already touched within lookback window (ORG-WIDE).
    // Attribute the skip to the originating property so the broker can see
    // "ah, I emailed this person about Super 8 two days ago — that's why
    // they're not on the Liberty blast list."
    const emailLower = lead.email.toLowerCase().trim();
    if (touchedEmails.has(emailLower)) {
      const prev = touchedEmailToProperty.get(emailLower);
      const isSameProperty = prev?.propertyId === body.propertyId;
      const propName = prev?.propertyId
        ? (isSameProperty
            ? "this property"
            : propertyNamesById.get(prev.propertyId) ?? "another property")
        : "recent outbound";
      skipped.push({
        leadId: lead.id,
        email: lead.email,
        reason: isSameProperty
          ? `outbound sent within last ${skipDays} days (this property)`
          : `outbound sent within last ${skipDays} days re: ${propName} — would double-email`,
      });
      continue;
    }
    // Skip: opted out (CAN-SPAM) — unconditional, never email
    if (optouts.has(emailLower)) {
      skipped.push({ leadId: lead.id, email: lead.email, reason: "opted out (CAN-SPAM)" });
      continue;
    }
    // Skip: daily send cap reached. Real-send only — dry-run ignores cap so
    // the broker can see what WOULD happen if they upped the limit.
    if (!body.dryRun && remainingDailyBudget <= 0) {
      skipped.push({
        leadId: lead.id,
        email: lead.email,
        reason: `daily send cap (${dailyCap}) reached — try again tomorrow or raise cap in Broker voice`,
      });
      continue;
    }

    // Detect listing-side vs owner-side. If the property has any active for-sale
    // status, the CREXi-style engagement signal means this person is a BUYER who
    // looked at our listing — route to listing_inquiry_followup, not the generic
    // warm_lead_followup (which historically produced owner-side cold-prospect copy).
    const propertyIsListing = !!(
      prop.for_sale_status &&
      ["active", "listed", "pending", "under_contract"].includes(
        String(prop.for_sale_status).toLowerCase()
      )
    );

    // Generate personalized message
    // Capture archetype once so we can use it for both the prompt and the
    // captured example below.
    const personaArchetype = archetypeFromContext({
      leadInterestLevel: lead.levelOfInterest,
      propertyIsListing,
    });

    let personalized;
    try {
      personalized = await personalizeTouch({
        channel: "email",
        archetype: personaArchetype,
        propertyId: prop.id,
        property: {
          address: prop.address,
          city: prop.city,
          state: prop.state,
          assetType: prop.asset_type,
          sqft: prop.sqft,
          units: prop.units,
          yearBuilt: prop.year_built,
          capRate: prop.cap_rate ? Number(prop.cap_rate) : null,
          buildingClass: prop.building_class,
          submarket: prop.submarket,
          forSaleStatus: prop.for_sale_status,
          yearsOwned: prop.years_owned,
          lastSalePrice: prop.last_sale_price ? Number(prop.last_sale_price) : null,
          mortgageMaturityDate: prop.mortgage_maturity_date,
          mortgageLender: prop.mortgage_lender,
          estimatedValue: prop.estimated_value ? Number(prop.estimated_value) : null,
          name: prop.name,
          marketingNotes: prop.marketing_notes,
          documentInventory: prop.document_inventory,
        },
        recipient: {
          name: lead.name,
          role: lead.role,
          company: lead.company,
          lastAction: lead.levelOfInterest,
          lastActionDate: lead.lastActivityDate,
          visitCount: lead.visitCount,
        },
        sender: DEFAULT_SENDER,
      });
    } catch (err) {
      failed.push({ leadId: lead.id, email: lead.email, error: `AI generate failed: ${err instanceof Error ? err.message : err}` });
      continue;
    }

    if (body.dryRun) {
      sent.push({
        leadId: lead.id,
        email: lead.email,
        messageId: "(dry-run)",
        threadId: "(dry-run)",
        subject: personalized.subject,
        body: personalized.body,
        rationale: personalized.rationale,
        recipientName: lead.name,
      });
      // Add to touched set so subsequent same-email leads in this batch get skipped
      touchedEmails.add(emailLower);
      continue;
    }

    // Send via Gmail
    try {
      const fromHeader = `${SEND_DISPLAY_NAME} <${gmailToken!.email}>`;
      const toHeader = lead.name ? `"${lead.name}" <${lead.email}>` : lead.email;
      const sentResult = await sendMessage(gmailToken!.accessToken, {
        to: toHeader,
        from: fromHeader,
        subject: personalized.subject,
        bodyText: personalized.body,
      });
      const sentAt = new Date().toISOString();

      // Log activity (timeline) + communications (outbound record)
      await supabase.from("activities").insert({
        organization_id: ORG_ID,
        activity_type: "email",
        subject: personalized.subject,
        body: personalized.body,
        occurred_at: sentAt,
        property_id: prop.id,
      });
      await supabase.from("communications").insert({
        organization_id: ORG_ID,
        property_id: prop.id,
        channel: "email",
        direction: "outbound",
        external_id: sentResult.id,
        subject: personalized.subject,
        body_preview: personalized.body.slice(0, 500),
        from_address: gmailToken!.email,
        to_addresses: [lead.email],
        occurred_at: sentAt,
        raw_payload: {
          gmail_message_id: sentResult.id,
          gmail_thread_id: sentResult.threadId,
          ai_rationale: personalized.rationale,
          source: "bulk-ai-followup",
          source_lead_id: lead.id,
        },
      });

      // Capture as a voice example so future AI drafts pattern-match on it.
      // Best-effort — failures here don't break the send loop.
      await captureVoiceExample(supabase, {
        channel: "email",
        subject: personalized.subject,
        body: personalized.body,
        source: "ai_drafted",
        personaSlug: personaArchetype,
        propertyId: prop.id,
        recipientEngagement: lead.levelOfInterest,
        recipientProfileSnapshot: {
          name: lead.name,
          company: lead.company,
          role: lead.role,
          visit_count: lead.visitCount,
        },
        sentAt,
      });

      sent.push({
        leadId: lead.id,
        email: lead.email,
        messageId: sentResult.id,
        threadId: sentResult.threadId,
        subject: personalized.subject,
        body: personalized.body,
        rationale: personalized.rationale,
        recipientName: lead.name,
      });
      // Add to touched set so subsequent same-email leads in this batch get skipped
      touchedEmails.add(emailLower);
      // Decrement remaining daily budget (real sends only — dry-run never enters this branch)
      remainingDailyBudget -= 1;
    } catch (err) {
      failed.push({
        leadId: lead.id,
        email: lead.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: body.dryRun ?? false,
    attempted: unified.length,
    sent: sent.length,
    skipped_count: skipped.length,
    failed_count: failed.length,
    sent_rows: sent,
    skipped,
    failed,
  });
}
