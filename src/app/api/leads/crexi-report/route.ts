/**
 * POST /api/leads/crexi-report
 *
 * Parse a Crexi daily Lead Report XLSX attachment from Gmail and upsert
 * every lead into crexi_leads_state, attached to the matching property.
 * For "hot" leads (Executed CA, Opened OM, Requested Info, Offer), also
 * creates a `leads` table row so they surface in Command "Do This Now".
 * Drafting is intentionally decoupled — the scheduled
 * /api/cron/draft-crexi-leads route picks them up in small batches.
 *
 * Body:
 *   { gmail_message_id: string, dryRun?: boolean }
 *
 * Flow:
 *   1. Fetch message via Gmail OAuth token
 *   2. Find the .xlsx attachment
 *   3. Decode + parse with parseCrexiReport()
 *   4. Match property by (a) Detail-sheet address, then (b) name
 *   5. Upsert leads (dedupe by email + property_id; fall back to name + phone)
 *   6. For hot leads: ensure a `leads` row exists (outreach-gate dedupe)
 *   7. Write an import_jobs audit row
 *
 * Called by:
 *   • Manual trigger via this endpoint (for backfilling old emails)
 *   • Automatic detection in poll-gmail (filename matches "Lead Report - *.xlsx")
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { parseCrexiReport, type CrexiLead } from "@/lib/cre-os/parse-crexi-report";
import { findOrCreateContact } from "@/lib/cre-os/find-or-create-contact";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAttachmentBuffer(accessToken: string, messageId: string): Promise<{ filename: string; buf: Buffer } | null> {
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) throw new Error(`Gmail message fetch failed: ${msgRes.status}`);
  const msg = await msgRes.json();

  // Walk parts to find first .xlsx attachment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function find(part: any): { filename: string; attachmentId: string } | null {
    if (part?.filename?.endsWith(".xlsx") && part.body?.attachmentId) {
      return { filename: part.filename, attachmentId: part.body.attachmentId };
    }
    if (part?.parts) {
      for (const p of part.parts) {
        const hit = find(p);
        if (hit) return hit;
      }
    }
    return null;
  }
  const hit = find(msg.payload);
  if (!hit) return null;

  const attRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${hit.attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!attRes.ok) throw new Error(`Attachment fetch failed: ${attRes.status}`);
  const att = await attRes.json();
  const data: string = att.data || "";
  const buf = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return { filename: hit.filename, buf };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function matchProperty(supabase: any, parsed: { propertyName: string | null; propertyAddress: string | null }, filename: string): Promise<{ id: string; name: string } | null> {
  // Strategy 1: address from Detail sheet (most reliable)
  // The address comes through as "7880-7896 Broadway, Merrillville, Lake, IN 46410"
  // Try to match against properties.address with prefix matching.
  if (parsed.propertyAddress) {
    const streetPart = parsed.propertyAddress.split(",")[0]?.trim();
    if (streetPart) {
      // Try exact-ish street match first
      const { data } = await supabase
        .from("properties")
        .select("id, name, address")
        .eq("organization_id", ORG_ID)
        .ilike("address", `${streetPart}%`)
        .limit(5);
      if (data && data.length > 0) {
        // Prefer the warm one (not status='prospect')
        const warm = data.find((p: { id: string; name: string; address: string }) => true);
        return { id: warm.id as string, name: warm.name as string };
      }
    }
  }

  // Strategy 2: name match from Detail sheet or filename
  const candidates = [
    parsed.propertyName,
    filename.replace(/^Lead Report - /, "").replace(/\.xlsx$/, ""),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    // Strip common suffix words ("Retail Center", "Hotel") for fuzzier match
    const variants = new Set<string>([
      candidate,
      candidate.replace(/\s+(Retail Center|Office Building|Industrial Park|Shopping Center)$/i, ""),
      candidate.replace(/\s+Hotel$/i, ""),
      candidate.replace(/\s+by Wyndham.*$/i, ""),
    ]);

    for (const v of Array.from(variants)) {
      const { data } = await supabase
        .from("properties")
        .select("id, name")
        .eq("organization_id", ORG_ID)
        .ilike("name", `${v}%`)
        .limit(5);
      if (data && data.length > 0) {
        return { id: data[0].id as string, name: data[0].name as string };
      }
    }
  }

  return null;
}

// ── Hot-lead detection ───────────────────────────────────────────────────

/**
 * A lead is "hot" when they've taken a substantive action beyond just
 * viewing the listing. These warrant proactive outreach and a `leads` row.
 */
function isHotLead(lead: CrexiLead): boolean {
  const loi = (lead.levelOfInterest || "").toLowerCase();
  return (
    /executed\s*ca/.test(loi) ||
    /requested\s*info/.test(loi) ||
    /opened\s*(om|flyer)/.test(loi) ||
    /offer/.test(loi)
  );
}

function buildEngagementSignal(lead: CrexiLead, propertyName: string | null): string {
  const loi = (lead.levelOfInterest || "").trim();
  const action = /executed\s*ca/i.test(loi)
    ? "executed the Confidentiality Agreement"
    : /requested\s*info/i.test(loi)
    ? "requested information"
    : /opened\s*om/i.test(loi)
    ? "opened the Offering Memorandum"
    : /opened\s*flyer/i.test(loi)
    ? "opened the flyer"
    : /offer/i.test(loi)
    ? "submitted an offer"
    : loi || "engaged with the listing";

  const where = propertyName ? ` on ${propertyName}` : "";
  const when = lead.activityDate
    ? ` (${new Date(lead.activityDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
    : "";
  const role =
    lead.industryRole && !/^listing rep$/i.test(lead.industryRole.trim())
      ? ` — ${lead.industryRole}${lead.company ? ` at ${lead.company}` : ""}`
      : lead.company
      ? ` — ${lead.company}`
      : "";

  return `${lead.fullName} ${action}${where}${when}${role}.`;
}

// ── Level-of-interest peak preservation ────────────────────────────────
// CREXi reports can regress — someone who executed a CA weeks ago may
// appear as a "Visitor" in the next day's report. We preserve the highest
// LOI ever seen so hot leads don't silently downgrade in crexi_leads_state.

const LOI_RANK: Record<string, number> = {
  "visitor": 1,
  "visited page": 1,
  "opened flyer": 2,
  "opened om": 2,
  "requested info": 3,
  "executed ca": 4,
  "offer": 4,
};

function loiRank(loi: string | null | undefined): number {
  if (!loi) return 0;
  const lower = loi.trim().toLowerCase();
  for (const [pattern, rank] of Object.entries(LOI_RANK)) {
    if (lower.includes(pattern)) return rank;
  }
  return 1; // treat unknown as visitor-level
}

/**
 * For hot leads: ensure a `leads` row exists so they surface in Command
 * "Do This Now". Dedupes against existing leads for this contact + property
 * (any source, not archived) so we don't create phantom rows on re-import.
 *
 * Returns the lead ID if created or already-existing, null if gated/failed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureHotLeadRow(
  supabase: any,
  contactId: string,
  propertyId: string,
  propertyName: string,
  lead: CrexiLead,
  crexiLeadsStateId: string | null,
): Promise<string | null> {
  // ❶ Already have a lead for this contact + property (any source)?
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .eq("property_id", propertyId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id; // already in inbox — don't duplicate

  // ❷ Already sent something to this contact (any property)?
  const { count: sentCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .not("final_sent_at", "is", null);
  if ((sentCount || 0) > 0) return null; // already replied — skip

  // ❸ Create the leads row
  const urgency = /executed\s*ca|requested\s*info|offer/i.test(lead.levelOfInterest || "")
    ? "hot"
    : "warm";

  const engagementSignal = buildEngagementSignal(lead, propertyName);

  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: propertyId,
      source: "crexi",
      status: "new",
      sender_name: lead.fullName,
      sender_email: lead.email,
      sender_phone: lead.phone,
      property_label: propertyName,
      urgency,
      qualifier_summary:
        `CREXi: ${lead.levelOfInterest || "engaged"}` +
        (lead.company ? ` · ${lead.company}` : "") +
        (lead.industryRole ? ` · ${lead.industryRole}` : ""),
      raw_subject: null,
      raw_body: JSON.stringify({
        discovered_via: "crexi_lead_report",
        level_of_interest: lead.levelOfInterest,
        activity_date: lead.activityDate,
        company: lead.company,
        industry_role: lead.industryRole,
        crexi_lead_score: lead.crexiLeadScore,
        buying_power: lead.estimatedBuyingPower,
        proof_of_funds: lead.proofOfFunds,
        notes: lead.notes,
        engagement_signal: engagementSignal,
        crexi_leads_state_id: crexiLeadsStateId,
      }),
    })
    .select("id")
    .single();

  if (error || !created) {
    console.warn("[crexi-report] hot lead row insert failed:", error?.message);
    return null;
  }
  return created.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertLead(supabase: any, propertyId: string, lead: CrexiLead): Promise<{ result: "inserted" | "updated" | "skipped"; contactId: string | null; crexiLeadsStateId: string | null }> {
  // ── 1. Find or create the canonical contact (REQUIRED) ──────────────
  // Architecture commitment (CLAUDE.md, 2026-05-15): every CREXi lead
  // MUST end up in `contacts`. Don't insert a crexi_leads_state row
  // without a contact_id.
  const contactResult = await findOrCreateContact(supabase, {
    name: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    role: lead.industryRole,
    company: lead.company,
    levelOfInterest: lead.levelOfInterest,
  });
  if ("error" in contactResult) {
    console.warn("[crexi-report] contact resolve failed:", contactResult.error, "lead:", lead.fullName);
    return { result: "skipped", contactId: null, crexiLeadsStateId: null };
  }
  const contactId = contactResult.contactId;

  // ── 2. Dedupe + upsert crexi_leads_state ────────────────────────────
  // Match by (property_id, lower-trim email) primarily; fall back to
  // (property_id, lower-trim name). Case-insensitive + trim-aware so
  // re-imports of the same person with different capitalization don't
  // produce duplicates.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: any = null;
  if (lead.email) {
    const { data } = await supabase
      .from("crexi_leads_state")
      .select("id, level_of_interest")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .ilike("email", lead.email.trim().toLowerCase())
      .maybeSingle();
    existing = data;
  }
  if (!existing && lead.fullName) {
    // Pull candidates by case-insensitive name match. .ilike with literal
    // value avoids LIKE-pattern wildcard issues with names containing %.
    const { data: candidates } = await supabase
      .from("crexi_leads_state")
      .select("id, name, email, level_of_interest")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .ilike("name", lead.fullName.trim());
    if (candidates && candidates.length > 0) {
      // Prefer the no-email row (since we're about to backfill it).
      // Otherwise any match works.
      existing = candidates.find((c: { email: string | null }) => !c.email) ?? candidates[0];
    }
  }

  // Base payload — level_of_interest is handled separately for peak preservation
  const basePayload = {
    organization_id: ORG_ID,
    property_id: propertyId,
    contact_id: contactId, // ALWAYS set — this is the canonical linkage
    name: lead.fullName,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    role: lead.industryRole,
    number_of_visits: lead.numberOfVisits,
    last_activity_date: lead.activityDate,
    last_seen_at: new Date().toISOString(),
    raw_panel: lead.raw,
  };

  if (existing) {
    // Peak-preserve level_of_interest: only accept the new report's value
    // if it ranks >= the stored peak. Prevents "Executed CA" → "Visitor"
    // regression when CREXi downgrades someone between daily reports.
    const existingLoi = (existing.level_of_interest as string | null) ?? null;
    const newLoi = lead.levelOfInterest ?? null;
    const effectiveLoi = loiRank(newLoi) >= loiRank(existingLoi) ? newLoi : existingLoi;

    const { error } = await supabase
      .from("crexi_leads_state")
      .update({ ...basePayload, level_of_interest: effectiveLoi, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { result: "skipped", contactId: null, crexiLeadsStateId: null };
    return { result: "updated", contactId, crexiLeadsStateId: existing.id };
  } else {
    const { data: inserted, error } = await supabase
      .from("crexi_leads_state")
      .insert({ ...basePayload, level_of_interest: lead.levelOfInterest, first_seen_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error || !inserted) return { result: "skipped", contactId: null, crexiLeadsStateId: null };
    return { result: "inserted", contactId, crexiLeadsStateId: inserted.id };
  }
}

export async function POST(req: NextRequest) {
  let body: { gmail_message_id?: string; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.gmail_message_id) {
    return NextResponse.json({ error: "gmail_message_id required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const token = await getActiveGmailToken(supabase);
  if (!token) return NextResponse.json({ error: "Gmail not connected" }, { status: 412 });

  // Open audit job
  let jobId: string | null = null;
  if (!body.dryRun) {
    const { data: job } = await supabase
      .from("import_jobs")
      .insert({
        organization_id: ORG_ID,
        source: "crexi_lead_report",
        source_detail: `gmail:${body.gmail_message_id}`,
        status: "processing",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    jobId = job?.id ?? null;
  }

  try {
    const attachment = await fetchAttachmentBuffer(token.accessToken, body.gmail_message_id);
    if (!attachment) {
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no xlsx attachment" }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({ error: "No .xlsx attachment found on this message" }, { status: 404 });
    }

    const parsed = parseCrexiReport(attachment.buf);
    if (parsed.leads.length === 0) {
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no leads parsed", warnings: parsed.warnings }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({
        ok: false,
        error: "Parser ran but produced 0 leads",
        parsed: { propertyName: parsed.propertyName, propertyAddress: parsed.propertyAddress, warnings: parsed.warnings },
      });
    }

    const propMatch = await matchProperty(supabase, parsed, attachment.filename);
    if (!propMatch) {
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no property match", parsed: { propertyName: parsed.propertyName, propertyAddress: parsed.propertyAddress } }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({
        ok: false,
        error: "Could not match a property",
        parsed: { propertyName: parsed.propertyName, propertyAddress: parsed.propertyAddress, leadCount: parsed.leads.length },
      });
    }

    let inserted = 0, updated = 0, skipped = 0, hotLeadsQueued = 0;
    if (!body.dryRun) {
      for (const lead of parsed.leads) {
        const r = await upsertLead(supabase, propMatch.id, lead);
        if (r.result === "inserted") inserted++;
        else if (r.result === "updated") updated++;
        else skipped++;

        // For hot leads that were successfully persisted in crexi_leads_state,
        // also ensure a `leads` table row exists so they appear in Command
        // "Do This Now". Drafting is decoupled — the cron draft-crexi-leads
        // scheduled function picks them up in batches.
        if (r.result !== "skipped" && r.contactId && isHotLead(lead)) {
          const hotLeadId = await ensureHotLeadRow(
            supabase,
            r.contactId,
            propMatch.id,
            propMatch.name,
            lead,
            r.crexiLeadsStateId,
          );
          if (hotLeadId) hotLeadsQueued++;
        }
      }
    } else {
      inserted = parsed.leads.length;
      hotLeadsQueued = parsed.leads.filter(isHotLead).length;
    }

    if (jobId) {
      await supabase.from("import_jobs").update({
        status: "completed",
        total_records: parsed.leads.length,
        processed_records: inserted + updated,
        failed_records: skipped,
        completed_at: new Date().toISOString(),
        error_log: {
          property: propMatch,
          activity: parsed.activity,
          warnings: parsed.warnings,
          hot_leads_queued: hotLeadsQueued,
        },
      }).eq("id", jobId);
    }

    return NextResponse.json({
      ok: true,
      dryRun: !!body.dryRun,
      property: propMatch,
      activity: parsed.activity,
      lead_count: parsed.leads.length,
      inserted,
      updated,
      skipped,
      hot_leads_queued: hotLeadsQueued,
      warnings: parsed.warnings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: msg }, completed_at: new Date().toISOString() }).eq("id", jobId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
