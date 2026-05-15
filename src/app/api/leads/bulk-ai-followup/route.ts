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
      estimated_value, owner_name_raw, marketing_notes
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
  const skipDays = body.skipIfTouchedWithinDays ?? 7;
  const cutoff = new Date(Date.now() - skipDays * 86400_000).toISOString();
  const { data: recentOut } = await supabase
    .from("communications")
    .select("to_addresses, occurred_at")
    .eq("organization_id", ORG_ID)
    .eq("property_id", body.propertyId)
    .eq("direction", "outbound")
    .gte("occurred_at", cutoff);
  const touchedEmails = new Set<string>();
  for (const c of (recentOut ?? []) as Array<{ to_addresses: string[] | null }>) {
    for (const a of c.to_addresses ?? []) touchedEmails.add(a.toLowerCase().trim());
  }

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
    // Skip: already touched within lookback window
    const emailLower = lead.email.toLowerCase().trim();
    if (touchedEmails.has(emailLower)) {
      skipped.push({ leadId: lead.id, email: lead.email, reason: `outbound sent within last ${skipDays} days` });
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
    let personalized;
    try {
      personalized = await personalizeTouch({
        channel: "email",
        archetype: archetypeFromContext({
          leadInterestLevel: lead.levelOfInterest,
          propertyIsListing,
        }),
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
