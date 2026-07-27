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
async function fetchAttachmentBuffers(accessToken: string, messageId: string): Promise<Array<{ filename: string; buf: Buffer }>> {
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) throw new Error(`Gmail message fetch failed: ${msgRes.status}`);
  const msg = await msgRes.json();

  // Walk parts and collect EVERY Lead Report attachment in the email.
  // A single email can carry multiple attachments — e.g. Liberty Square +
  // Super 8 in one forward. The old code returned the FIRST hit and stopped,
  // silently dropping the second. We now collect them all and the caller
  // processes each one as a separate report.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function collect(part: any, out: Array<{ filename: string; attachmentId: string }>): void {
    if (part?.body?.attachmentId) {
      const fn: string = part.filename || "";
      if (/\.(xlsx|csv)$/i.test(fn)) {
        out.push({ filename: fn, attachmentId: part.body.attachmentId });
      }
    }
    if (Array.isArray(part?.parts)) {
      for (const p of part.parts) collect(p, out);
    }
  }
  const hits: Array<{ filename: string; attachmentId: string }> = [];
  collect(msg.payload, hits);
  if (hits.length === 0) return [];

  // De-dupe by attachmentId in case the same part is referenced multiple
  // times (Gmail occasionally does this for nested multipart structures).
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    if (seen.has(h.attachmentId)) return false;
    seen.add(h.attachmentId);
    return true;
  });

  // Prefer XLSX over CSV when BOTH exist for the same property (i.e. CREXi
  // sometimes attaches both formats). Dedupe by filename-without-extension.
  const byBaseName = new Map<string, { filename: string; attachmentId: string }>();
  for (const h of unique) {
    const base = h.filename.replace(/\.(xlsx|csv)$/i, "").toLowerCase();
    const existing = byBaseName.get(base);
    if (!existing) {
      byBaseName.set(base, h);
    } else {
      // XLSX wins over CSV for the same property
      const existingIsXlsx = /\.xlsx$/i.test(existing.filename);
      const newIsXlsx = /\.xlsx$/i.test(h.filename);
      if (newIsXlsx && !existingIsXlsx) byBaseName.set(base, h);
    }
  }

  // Fetch each attachment binary
  const results: Array<{ filename: string; buf: Buffer }> = [];
  for (const hit of Array.from(byBaseName.values())) {
    const attRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${hit.attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!attRes.ok) throw new Error(`Attachment fetch failed for ${hit.filename}: ${attRes.status}`);
    const att = await attRes.json();
    const data: string = att.data || "";
    const buf = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    results.push({ filename: hit.filename, buf });
  }
  return results;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Normalize a US street address for comparison. Strips direction
 * prefixes (N/S/E/W and their long forms) and normalizes common
 * street-type abbreviations so "8474 South Colorado Street" and
 * "8474 Colorado St" produce the same fuzzy-match key.
 */
function normalizeStreet(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .trim()
    // Strip the direction word right after the house number
    .replace(/^(\d+)\s+(n|s|e|w|north|south|east|west|ne|nw|se|sw)\s+/i, "$1 ")
    // Normalize street-type words
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\blane\b/g, "ln")
    .replace(/\bplace\b/g, "pl")
    .replace(/\broad\b/g, "rd")
    .replace(/\bhighway\b/g, "hwy")
    .replace(/\bparkway\b/g, "pkwy")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * From a candidate list, pick the property that John is most likely
 * to want the leads attached to. Preference order:
 *   1. Property with a non-null crexi_listing_id (we wired this up)
 *   2. Property where your_role = 'listing_broker' (John's listings)
 *   3. Property whose status is not 'prospect' (any non-cold record)
 *   4. Whatever was first
 *
 * This is the fix for the prior "prefer the warm one" comment that
 * was followed by `data.find(() => true)` — which returned the
 * first row regardless. The 19 Portage leads landed on a
 * status=prospect record because of that bug.
 */
function pickBestCandidate<T extends {
  id: string;
  name: string;
  crexi_listing_id?: string | null;
  your_role?: string | null;
  status?: string | null;
}>(rows: T[]): T | null {
  if (!rows || rows.length === 0) return null;
  const withCrexi = rows.find((r) => r.crexi_listing_id);
  if (withCrexi) return withCrexi;
  const listingBroker = rows.find((r) => r.your_role === "listing_broker");
  if (listingBroker) return listingBroker;
  const nonProspect = rows.find((r) => r.status && r.status !== "prospect");
  if (nonProspect) return nonProspect;
  return rows[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isStrongMatch(p: any): boolean {
  // A "strong" match is a property we're confident John actually owns
  // the relationship for — crexi listing wired up OR he's the listing
  // broker. Without one of those, address matches against the 15k
  // public-record prospects can grab the wrong row.
  return !!p && (!!p.crexi_listing_id || p.your_role === "listing_broker");
}

async function matchProperty(supabase: any, parsed: { propertyName: string | null; propertyAddress: string | null }, filename: string): Promise<{ id: string; name: string } | null> {
  // Collect candidates from BOTH strategies, then pick the strongest
  // overall. Strategy 1's address match was previously short-circuiting
  // any candidate it found — which routed the Portage report to a
  // status=prospect public-record row because Portage Land Sale has
  // no address set and so couldn't be found by address at all.
  //
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collected: any[] = [];

  // Strategy 1: address from Detail sheet, normalized street compare.
  if (parsed.propertyAddress) {
    const streetPart = parsed.propertyAddress.split(",")[0]?.trim();
    if (streetPart) {
      const targetKey = normalizeStreet(streetPart);

      // Tight prefix match (happy path — no normalization needed).
      const { data: tight } = await supabase
        .from("properties")
        .select("id, name, address, crexi_listing_id, your_role, status")
        .eq("organization_id", ORG_ID)
        .ilike("address", `${streetPart}%`)
        .limit(10);
      collected.push(...(tight ?? []));

      // Loose pass — bare house-number prefix + normalized compare in
      // JS. Handles "South" prefix, "Street" vs "St", etc.
      const houseNum = streetPart.match(/^\d+/)?.[0];
      if (houseNum) {
        const { data: loose } = await supabase
          .from("properties")
          .select("id, name, address, crexi_listing_id, your_role, status")
          .eq("organization_id", ORG_ID)
          .ilike("address", `${houseNum}%`)
          .limit(20);
        const normalizedMatches = (loose ?? []).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (p: any) => {
            const candKey = normalizeStreet(p.address);
            return candKey.startsWith(targetKey) || targetKey.startsWith(candKey);
          }
        );
        collected.push(...normalizedMatches);
      }
    }
  }

  // If Strategy 1 already found a strong candidate (crexi_listing_id
  // set or your_role=listing_broker), prefer it immediately — name
  // matching adds noise without upgrading confidence.
  const strongFromS1 = collected.find(isStrongMatch);
  if (strongFromS1) return { id: strongFromS1.id, name: strongFromS1.name };

  // Strategy 2: name match from Detail sheet AND filename. Filename
  // often carries the broker's property name even when the address
  // matches a different record (e.g. "Lead_Report_Melton_Rd_Portage"
  // → the broker calls it "Portage Land Sale").
  const candidates = [
    parsed.propertyName,
    filename.replace(/^Lead.?Report.?/i, "").replace(/\.xlsx$/i, "").replace(/_/g, " ").trim(),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const variants = new Set<string>([
      candidate,
      candidate.replace(/\s+(Retail Center|Office Building|Industrial Park|Shopping Center)$/i, ""),
      candidate.replace(/\s+Hotel$/i, ""),
      candidate.replace(/\s+by Wyndham.*$/i, ""),
    ]);

    // Try each variant against name. Also try individual words from
    // the variant (often a city/landmark — e.g. "Portage" from
    // "Melton Rd Portage").
    //
    // CRITICAL: filter to "strong" properties at the SQL level —
    // crexi_listing_id set OR your_role=listing_broker OR status not
    // prospect. Without this, a search for "%Portage%" returns 10
    // public-record prospects out of ~60, and "Portage Land Sale"
    // doesn't make the cut. The matcher should never return a
    // prospect from a name match — addresses are the only signal
    // strong enough to risk that.
    const strongFilter = "crexi_listing_id.not.is.null,your_role.eq.listing_broker,status.neq.prospect";

    for (const v of Array.from(variants)) {
      const words = v.split(/\s+/).filter(Boolean);
      const tries = new Set<string>([v, ...words.filter((w) => w.length >= 4)]);
      for (const t of Array.from(tries)) {
        const { data } = await supabase
          .from("properties")
          .select("id, name, crexi_listing_id, your_role, status")
          .eq("organization_id", ORG_ID)
          .ilike("name", `%${t}%`)
          .or(strongFilter)
          .limit(20);
        collected.push(...(data ?? []));
      }
    }
  }

  // Combined pick — pickBestCandidate prefers crexi_listing_id >
  // listing_broker > non-prospect > first. Drops duplicates so the
  // same row isn't preferred just because it appears in two strategies.
  const seen = new Set<string>();
  const deduped = collected.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  const pick = pickBestCandidate(deduped);
  return pick ? { id: pick.id, name: pick.name } : null;
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

  // ❹ Check if we've already sent an email to this contact about this property.
  //    If so, create the lead as 'sent' (not 'new') so it doesn't pollute the
  //    hot inbox — it should only resurface when they reply.
  const { data: priorSend } = await supabase
    .from("communications")
    .select("occurred_at")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .eq("property_id", propertyId)
    .eq("direction", "outbound")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const alreadySent = !!priorSend;

  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: propertyId,
      source: "crexi",
      status: alreadySent ? "sent" : "new",
      final_sent_at: alreadySent ? priorSend?.occurred_at : null,
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

  // Mirror into communications so the comms dashboard + coverage check see
  // this inbound interest. channel='website' — CREXi is a platform inquiry,
  // and 'crexi' is not in the communications.channel CHECK vocabulary.
  const { error: commErr } = await supabase.from("communications").insert({
    organization_id: ORG_ID,
    lead_id: created.id,
    contact_id: contactId,
    property_id: propertyId,
    channel: "website",
    direction: "inbound",
    external_id: null,
    subject: `CREXi activity: ${propertyName}`,
    body_preview:
      `${lead.levelOfInterest || "engaged"}` +
      (lead.company ? ` · ${lead.company}` : "") +
      (lead.industryRole ? ` · ${lead.industryRole}` : "") +
      (lead.notes ? ` · ${String(lead.notes).slice(0, 200)}` : ""),
    from_address: senderEmail,
    occurred_at: new Date().toISOString(),
    raw_payload: {
      source: "crexi_report",
      level_of_interest: lead.levelOfInterest,
      activity_date: lead.activityDate,
    },
  });
  if (commErr) {
    console.error("[crexi-report] comm insert failed:", commErr.message);
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

  const sourceDetail = `gmail:${body.gmail_message_id}`;

  // Idempotency check — poll-gmail re-processes the same Gmail message
  // every minute until it's marked read, so without this we'd create
  // 5+ duplicate import_jobs per delivery + re-run the (idempotent but
  // expensive) parse + upsert path 5+ times. If we already have a
  // completed job for this Gmail message, short-circuit.
  if (!body.dryRun) {
    const { data: existing } = await supabase
      .from("import_jobs")
      .select("id, status, total_records, processed_records, failed_records, completed_at")
      .eq("organization_id", ORG_ID)
      .eq("source", "crexi_lead_report")
      .eq("source_detail", sourceDetail)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already_processed",
        prior_import_job_id: existing.id,
        prior_completed_at: existing.completed_at,
        total_records: existing.total_records,
      });
    }
  }

  // Open audit job
  let jobId: string | null = null;
  if (!body.dryRun) {
    const { data: job } = await supabase
      .from("import_jobs")
      .insert({
        organization_id: ORG_ID,
        source: "crexi_lead_report",
        source_detail: sourceDetail,
        status: "processing",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    jobId = job?.id ?? null;
  }

  try {
    // Fetch ALL XLSX/CSV attachments — a single email can carry multiple
    // (e.g. Liberty Square + Super 8 in one forward). Each is processed
    // independently so one bad file doesn't block the others.
    const attachments = await fetchAttachmentBuffersResolved(token.accessToken, body.gmail_message_id);
    if (attachments.length === 0) {
      if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: "no attachment found" }, completed_at: new Date().toISOString() }).eq("id", jobId);
      return NextResponse.json({ error: "No Lead Report attachment found on this message" }, { status: 404 });
    }

    // Process each attachment as its own report. Aggregate the results
    // into a single import_jobs row + response so the caller (poll-gmail)
    // sees one consolidated outcome for the email.
    type PerAttachmentResult = {
      filename: string;
      format: "xlsx_per_property" | "csv_master";
      ok: boolean;
      error?: string;
      property?: { id: string; name: string } | null;
      activity?: unknown;
      lead_count?: number;
      inserted?: number;
      updated?: number;
      skipped?: number;
      hot_leads_queued?: number;
      warnings?: string[];
      properties?: unknown;
      unmatched_properties?: string[];
    };
    const perAttachment: PerAttachmentResult[] = [];

    for (const attachment of attachments) {
      const r = await processOneAttachment(supabase, attachment, !!body.dryRun);
      perAttachment.push(r);
    }

    const okCount = perAttachment.filter((r) => r.ok).length;
    const failCount = perAttachment.length - okCount;
    const totalInserted = perAttachment.reduce((s, r) => s + (r.inserted ?? 0), 0);
    const totalUpdated = perAttachment.reduce((s, r) => s + (r.updated ?? 0), 0);
    const totalSkipped = perAttachment.reduce((s, r) => s + (r.skipped ?? 0), 0);
    const totalLeads = perAttachment.reduce((s, r) => s + (r.lead_count ?? 0), 0);
    const totalHot = perAttachment.reduce((s, r) => s + (r.hot_leads_queued ?? 0), 0);

    if (jobId) {
      await supabase.from("import_jobs").update({
        status: okCount > 0 ? "completed" : "failed",
        total_records: totalLeads,
        processed_records: totalInserted + totalUpdated,
        failed_records: totalSkipped,
        completed_at: new Date().toISOString(),
        error_log: {
          attachments: perAttachment,
          attachment_count: attachments.length,
          ok_count: okCount,
          fail_count: failCount,
          hot_leads_queued: totalHot,
        },
      }).eq("id", jobId);
    }

    return NextResponse.json({
      ok: okCount > 0,
      dryRun: !!body.dryRun,
      attachment_count: attachments.length,
      ok_count: okCount,
      fail_count: failCount,
      total_leads: totalLeads,
      inserted: totalInserted,
      updated: totalUpdated,
      skipped: totalSkipped,
      hot_leads_queued: totalHot,
      attachments: perAttachment,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) await supabase.from("import_jobs").update({ status: "failed", error_log: { error: msg }, completed_at: new Date().toISOString() }).eq("id", jobId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Thin wrapper that catches errors thrown by the Gmail attachment fetch
// so the caller can decide how to respond. Returns [] on hard failure.
async function fetchAttachmentBuffersResolved(accessToken: string, messageId: string): Promise<Array<{ filename: string; buf: Buffer }>> {
  try {
    return await fetchAttachmentBuffers(accessToken, messageId);
  } catch (err) {
    console.error(`[crexi-report] fetchAttachmentBuffers failed:`, err);
    return [];
  }
}

// Process a single XLSX or CSV attachment. Mirrors the original single-
// attachment flow but returns a structured result instead of writing to
// import_jobs directly — the caller aggregates results across attachments
// into one job row.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processOneAttachment(supabase: any, attachment: { filename: string; buf: Buffer }, dryRun: boolean): Promise<{
  filename: string;
  format: "xlsx_per_property" | "csv_master";
  ok: boolean;
  error?: string;
  property?: { id: string; name: string } | null;
  activity?: unknown;
  lead_count?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  hot_leads_queued?: number;
  warnings?: string[];
  properties?: unknown;
  unmatched_properties?: string[];
}> {
  try {
    const isCsv = /\.csv$/i.test(attachment.filename);

    // ── CSV path: all-property master format ────────────────────────────────
    if (isCsv) {
      const csvText = attachment.buf.toString("utf8");
      const groups = parseMasterCsv(csvText);

      if (groups.length === 0) {
        return { filename: attachment.filename, format: "csv_master", ok: false, error: "CSV parsed but produced 0 lead groups" };
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
        if (!dryRun) {
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

      return {
        filename: attachment.filename,
        format: "csv_master",
        ok: true,
        lead_count: totalLeads,
        inserted,
        updated,
        skipped,
        hot_leads_queued: hotLeadsQueued,
        properties: propertyResults,
        unmatched_properties: unmatchedProperties,
      };
    }

    // ── XLSX path: per-property format (original) ────────────────────────────
    const parsed = parseCrexiReport(attachment.buf);
    if (parsed.leads.length === 0) {
      return {
        filename: attachment.filename,
        format: "xlsx_per_property",
        ok: false,
        error: `Parser ran but produced 0 leads (parsed: name="${parsed.propertyName}" addr="${parsed.propertyAddress}")`,
        warnings: parsed.warnings,
      };
    }

    const propMatch = await matchProperty(supabase, parsed, attachment.filename);
    if (!propMatch) {
      return {
        filename: attachment.filename,
        format: "xlsx_per_property",
        ok: false,
        error: `Could not match a property (parsed: name="${parsed.propertyName}" addr="${parsed.propertyAddress}" leads=${parsed.leads.length})`,
        warnings: parsed.warnings,
      };
    }

    let inserted = 0, updated = 0, skipped = 0, hotLeadsQueued = 0;
    if (!dryRun) {
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

    return {
      filename: attachment.filename,
      format: "xlsx_per_property",
      ok: true,
      property: propMatch,
      activity: parsed.activity,
      lead_count: parsed.leads.length,
      inserted,
      updated,
      skipped,
      hot_leads_queued: hotLeadsQueued,
      warnings: parsed.warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      filename: attachment.filename,
      format: /\.csv$/i.test(attachment.filename) ? "csv_master" : "xlsx_per_property",
      ok: false,
      error: msg,
    };
  }
}
