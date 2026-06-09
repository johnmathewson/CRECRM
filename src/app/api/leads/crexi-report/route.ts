/**
 * POST /api/leads/crexi-report
 *
 * Parse a Crexi daily Lead Report attachment from Gmail and upsert every
 * lead into crexi_leads_state, attached to the matching property. For "hot"
 * leads (Executed CA, Opened OM, Requested Info, Offer), also creates a
 * `leads` table row so they surface in Command "Do This Now". Drafting is
 * intentionally decoupled — the scheduled /api/cron/draft-crexi-leads route
 * picks them up in small batches.
 *
 * Supports two attachment formats:
 *   • XLSX (per-property, three-sheet format with "Detail" tab) — original format
 *   • CSV  (all-property "Master Lead Report" — CREXi's newer export format)
 *
 * Body:
 *   { gmail_message_id: string, dryRun?: boolean }
 *
 * Flow:
 *   1. Fetch message via Gmail OAuth token
 *   2. Find the .xlsx OR .csv attachment
 *   3. XLSX: decode + parse with parseCrexiReport() → match single property
 *      CSV:  parse rows → group by Property ID → match each property by crexi_listing_id
 *   4. Upsert leads (dedupe by email + property_id; fall back to name + phone)
 *   5. For hot leads: ensure a `leads` row exists (outreach-gate dedupe)
 *   6. Write an import_jobs audit row
 *
 * Called by:
 *   • Manual trigger via this endpoint (for backfilling old emails)
 *   • Automatic detection in poll-gmail (filename matches Lead Report pattern)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { parseCrexiReport, type CrexiLead } from "@/lib/cre-os/parse-crexi-report";
import { findOrCreateContact } from "@/lib/cre-os/find-or-create-contact";
import { linkOrphanedComms } from "@/lib/cre-os/send-crm-email";

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

  // Walk parts to find first Lead Report attachment — XLSX preferred, CSV fallback.
  // CREXi switched from .xlsx to .csv in mid-2026; accept both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function find(part: any): { filename: string; attachmentId: string } | null {
    if (part?.body?.attachmentId) {
      const fn: string = part.filename || "";
      if (/\.(xlsx|csv)$/i.test(fn)) {
        return { filename: fn, attachmentId: part.body.attachmentId };
      }
    }
    if (part?.parts) {
      // Prefer XLSX over CSV if both are present
      let csvHit: { filename: string; attachmentId: string } | null = null;
      for (const p of part.parts) {
        const hit = find(p);
        if (!hit) continue;
        if (/\.xlsx$/i.test(hit.filename)) return hit; // XLSX wins immediately
        if (!csvHit) csvHit = hit;                     // stash first CSV
      }
      return csvHit;
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
    .select("id, sender_email")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .eq("property_id", propertyId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    // Heal missing email in-place — older lead rows may have been created
    // without sender_email if the CREXi report omitted it at the time.
    // The drafting cron skips leads with null sender_email, so patch it
    // whenever we now have a resolved email.
    const resolvedEmail = lead.email ?? null;
    if (!existing.sender_email && resolvedEmail) {
      await supabase
        .from("leads")
        .update({ sender_email: resolvedEmail, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    }
    return existing.id;
  }

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

  // Resolve email: prefer the parsed CREXi value, fall back to the
  // canonical contact record. Protects against cases where the CREXi
  // report omits the email column on a given row but the contact already
  // has it from a prior import — without this the leads row would be
  // created with sender_email=null and the drafting cron would skip it.
  let senderEmail = lead.email ?? null;
  if (!senderEmail) {
    const { data: contact } = await supabase
      .from("contacts")
      .select("email")
      .eq("id", contactId)
      .single();
    senderEmail = contact?.email ?? null;
  }

  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: propertyId,
      source: "crexi",
      status: "new",
      sender_name: lead.fullName,
      sender_email: senderEmail,
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

  // Link any orphaned outbound communications for this email to the new lead
  // so the ContactDrawer thread is populated immediately on first open.
  await linkOrphanedComms(supabase, created.id, senderEmail, propertyId);

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

// ── Master CSV parser ────────────────────────────────────────────────────────
// CREXi's newer all-property export format. One CSV with all properties.
// Columns: First,Last,Property,Property Type,Property ID,Address,Email,Phone,
//          Verification Method,Level of Interest,Crexi Lead Score,Source,
//          Last Action Date,Company,Industry Role,City,State,Attachments,
//          Estimated Buying Power,Note 1,Note 2,Note 3,Platform

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === "," && !inQuote) {
      cols.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function parseDateStr(s: string | null | undefined): string | null {
  if (!s) return null;
  // MM/DD/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

interface MasterCsvGroup {
  crexiPropertyId: string;
  propertyName: string;
  propertyAddress: string;
  leads: CrexiLead[];
}

function parseMasterCsv(csvText: string): MasterCsvGroup[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const idx = (name: string) => headers.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const iFirst     = idx("First");
  const iLast      = idx("Last");
  const iPropName  = idx("Property");
  const iPropId    = idx("Property ID");
  const iAddress   = idx("Address");
  const iEmail     = idx("Email");
  const iPhone     = idx("Phone");
  const iLoi       = idx("Level of Interest");
  const iScore     = idx("Crexi Lead Score");
  const iDate      = idx("Last Action Date");
  const iCompany   = idx("Company");
  const iRole      = idx("Industry Role");
  const iCity      = idx("City");
  const iState     = idx("State");
  const iBuyPow    = idx("Estimated Buying Power");
  const iNote1     = idx("Note 1");
  const iNote2     = idx("Note 2");
  const iNote3     = idx("Note 3");
  const iAttach    = idx("Attachments");

  const groups = new Map<string, MasterCsvGroup>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(lines[i]);
    const get = (j: number) => (j >= 0 ? (cols[j] ?? "").trim() : "");

    const crexiPropertyId = get(iPropId);
    const propertyName    = get(iPropName);
    const propertyAddress = get(iAddress);
    if (!crexiPropertyId) continue;

    const firstName = get(iFirst) || null;
    const lastName  = get(iLast) || null;
    if (!firstName && !lastName) continue;

    const notes = [get(iNote1), get(iNote2), get(iNote3)].filter(Boolean).join("\n\n") || null;

    const normalizePhone = (p: string): string | null => {
      const digits = p.replace(/\D/g, "");
      if (digits.length === 10) return `+1${digits}`;
      if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
      return digits ? `+${digits}` : null;
    };

    const lead: CrexiLead = {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(" "),
      phone: normalizePhone(get(iPhone)),
      email: get(iEmail).toLowerCase() || null,
      company: get(iCompany) || null,
      industryRole: get(iRole) || null,
      levelOfInterest: get(iLoi) || null,
      crexiLeadScore: get(iScore) ? parseFloat(get(iScore)) || null : null,
      activityDate: parseDateStr(get(iDate)),
      numberOfVisits: null,
      estimatedBuyingPower: get(iBuyPow) || null,
      aumNumber: null,
      aumValue: null,
      buyerBackground: null,
      proofOfFunds: null,
      confidence: null,
      notes,
      raw: {
        city: get(iCity) || null,
        state: get(iState) || null,
        attachments: get(iAttach) || null,
        property_id: crexiPropertyId,
        property_name: propertyName,
        address: propertyAddress,
      },
    };

    if (!groups.has(crexiPropertyId)) {
      groups.set(crexiPropertyId, { crexiPropertyId, propertyName, propertyAddress, leads: [] });
    }
    groups.get(crexiPropertyId)!.leads.push(lead);
  }

  return Array.from(groups.values());
}

// Match a property by CREXi listing ID (preferred) then by name/address.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function matchPropertyByCrxId(supabase: any, crexiId: string, name: string, address: string): Promise<{ id: string; name: string } | null> {
  // Strategy 1: direct crexi_listing_id match
  const { data: byId } = await supabase
    .from("properties")
    .select("id, name")
    .eq("organization_id", ORG_ID)
    .eq("crexi_listing_id", crexiId)
    .maybeSingle();
  if (byId) return byId;

  // Strategy 2: name match + backfill crexi_listing_id
  if (name) {
    const { data: byName } = await supabase
      .from("properties")
      .select("id, name")
      .eq("organization_id", ORG_ID)
      .ilike("name", name)
      .maybeSingle();
    if (byName) {
      await supabase.from("properties").update({ crexi_listing_id: crexiId }).eq("id", byName.id);
      return byName;
    }
  }

  // Strategy 3: address prefix match + backfill
  if (address) {
    const street = address.split(",")[0]?.trim();
    if (street) {
      const { data: rows } = await supabase
        .from("properties")
        .select("id, name")
        .eq("organization_id", ORG_ID)
        .ilike("address", `${street}%`);
      if (rows && rows.length === 1) {
        await supabase.from("properties").update({ crexi_listing_id: crexiId }).eq("id", rows[0].id);
        return rows[0];
      }
    }
  }

  return null;
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
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no attachment found" }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({ error: "No Lead Report attachment found on this message" }, { status: 404 });
    }

    const isCsv = /\.csv$/i.test(attachment.filename);

    // ── CSV path: all-property master format ────────────────────────────────
    if (isCsv) {
      const csvText = attachment.buf.toString("utf8");
      const groups = parseMasterCsv(csvText);

      if (groups.length === 0) {
        if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no leads parsed from CSV" }, completed_at: new Date().toISOString() }).eq("id", jobId);
        return NextResponse.json({ ok: false, error: "CSV parsed but produced 0 lead groups" });
      }

      let totalLeads = 0, inserted = 0, updated = 0, skipped = 0, hotLeadsQueued = 0;
      const propertyResults: Array<{ crexiId: string; name: string | null; matched: boolean; leads: number; hot: number }> = [];
      const unmatchedProperties: string[] = [];

      for (const group of groups) {
        const prop = await matchPropertyByCrxId(supabase, group.crexiPropertyId, group.propertyName, group.propertyAddress);
        if (!prop) {
          unmatchedProperties.push(`${group.crexiPropertyId} "${group.propertyName}"`);
          skipped += group.leads.length;
          propertyResults.push({ crexiId: group.crexiPropertyId, name: group.propertyName, matched: false, leads: group.leads.length, hot: 0 });
          continue;
        }

        let propHot = 0;
        if (!body.dryRun) {
          for (const lead of group.leads) {
            const r = await upsertLead(supabase, prop.id, lead);
            if (r.result === "inserted") inserted++;
            else if (r.result === "updated") updated++;
            else skipped++;

            if (r.result !== "skipped" && r.contactId && isHotLead(lead)) {
              const hotId = await ensureHotLeadRow(supabase, r.contactId, prop.id, prop.name, lead, r.crexiLeadsStateId);
              if (hotId) { hotLeadsQueued++; propHot++; }
            }
          }
        } else {
          inserted += group.leads.length;
          propHot = group.leads.filter(isHotLead).length;
          hotLeadsQueued += propHot;
        }
        totalLeads += group.leads.length;
        propertyResults.push({ crexiId: group.crexiPropertyId, name: prop.name, matched: true, leads: group.leads.length, hot: propHot });
      }

      if (jobId) {
        await supabase.from("import_jobs").update({
          status: "completed",
          total_records: totalLeads,
          processed_records: inserted + updated,
          failed_records: skipped,
          completed_at: new Date().toISOString(),
          error_log: {
            format: "csv_master",
            filename: attachment.filename,
            properties: propertyResults,
            unmatched_properties: unmatchedProperties,
            hot_leads_queued: hotLeadsQueued,
          },
        }).eq("id", jobId);
      }

      return NextResponse.json({
        ok: true,
        dryRun: !!body.dryRun,
        format: "csv_master",
        total_leads: totalLeads,
        inserted,
        updated,
        skipped,
        hot_leads_queued: hotLeadsQueued,
        properties: propertyResults,
        unmatched_properties: unmatchedProperties,
      });
    }

    // ── XLSX path: per-property format (original) ────────────────────────────
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

        if (r.result !== "skipped" && r.contactId && isHotLead(lead)) {
          const hotLeadId = await ensureHotLeadRow(supabase, r.contactId, propMatch.id, propMatch.name, lead, r.crexiLeadsStateId);
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
          format: "xlsx_per_property",
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
      format: "xlsx_per_property",
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
