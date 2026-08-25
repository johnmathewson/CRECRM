/**
 * POST /api/leads/bulk-import-crexi
 *
 * Ingests a CREXi "Lead Report" XLSX/CSV export — the daily proactive
 * lead-discovery channel. For each row:
 *
 *   1. Match property by name (rows 1-3 of the report) → CRM property_id.
 *   2. Push the activity summary (rows 4-6) into listing_metrics so the
 *      owner dashboard refreshes from this same import.
 *   3. For each lead row:
 *        a. Find or create contact by email/phone.
 *        b. Apply the "have we already reached out?" gate:
 *             - Skip if any prior lead for this contact + property has
 *               final_sent_at set (we already sent a real reply).
 *             - Skip if any prior lead has a pending draft_reply (don't
 *               pile on while John reviews the existing one).
 *             - Skip if any communication occurred in the last 7 days
 *               (cooldown).
 *        c. Otherwise create/update the lead and fire the proactive
 *           drafter via the shared helper.
 *
 * Auth: x-extension-key header (so Apps Script can call after pulling
 * the CSV out of inquiries@stewardshipcre.com).
 *
 * Inputs accepted:
 *   - multipart/form-data with a single file field named "file"
 *   - application/json with { file_b64: string, filename?: string }
 *
 * Body knobs:
 *   - dry_run=true (query param): parses + decides + reports outcomes
 *     without creating/drafting anything. Use to preview the first run.
 *   - max=N (query param): cap the number of rows actually drafted.
 *     Useful for a small first sanity check ("draft only the first 5").
 */

import { NextRequest, NextResponse } from "next/server";
import { ORG_ID, hashSecret } from "@/lib/owner-dashboard";
import { parseCrexiReport, CrexiLeadRow } from "@/lib/crexi-csv-parser";
import { draftLeadReply } from "@/lib/draft-lead-reply";
import { createServiceSupabase } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Up to 5 min — large CSV with many drafts

// ── Auth ──────────────────────────────────────────────────────────────────

async function authKey(supabase: any, key: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!key) return { ok: false, error: "Missing x-extension-key header" };
  const { data } = await supabase
    .from("extension_api_keys")
    .select("id, revoked_at")
    .eq("key_hash", hashSecret(key))
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!data) return { ok: false, error: "Invalid key" };
  if (data.revoked_at) return { ok: false, error: "Key revoked" };
  return { ok: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  // E.164, same as every other write path — mixed formats split SMS threads.
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 7 ? digits : null;
}

/**
 * Match this CREXi report to a CRM property by name (preferred) or
 * crexi_listing_id parsed out of any source URL we have.
 */
async function resolveProperty(
  supabase: any,
  reportName: string | null,
  reportAddress: string | null
): Promise<{ id: string; name: string } | null> {
  if (!reportName && !reportAddress) return null;

  // Try exact name match first
  if (reportName) {
    const { data } = await supabase
      .from("properties")
      .select("id, name")
      .eq("organization_id", ORG_ID)
      .ilike("name", reportName)
      .maybeSingle();
    if (data) return data;
  }

  // Then try fuzzy address match
  if (reportAddress) {
    // Pull the street number + first word of street as a substring
    const m = reportAddress.match(/^([\d-]+\s+[A-Za-z]+)/);
    if (m) {
      const { data } = await supabase
        .from("properties")
        .select("id, name, address")
        .eq("organization_id", ORG_ID)
        .ilike("address", `%${m[1]}%`);
      if (data && data.length === 1) {
        return { id: data[0].id, name: data[0].name };
      }
    }
  }

  // Fall back to fuzzy name search (substring)
  if (reportName) {
    const firstWord = reportName.split(/\s+/)[0];
    const { data } = await supabase
      .from("properties")
      .select("id, name")
      .eq("organization_id", ORG_ID)
      .ilike("name", `%${firstWord}%`);
    if (data && data.length === 1) return data[0];
  }

  return null;
}

/** Find or create a contact, deduping on email then phone-digits. */
async function resolveContact(
  supabase: any,
  lead: CrexiLeadRow
): Promise<{ id: string; created: boolean } | null> {
  // Try by email
  if (lead.email) {
    const { data } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", ORG_ID)
      .ilike("email", lead.email)
      .maybeSingle();
    if (data) return { id: data.id, created: false };
  }

  // Try by phone (normalize both sides — DB might store formatted)
  if (lead.phone) {
    const { data: candidates } = await supabase
      .from("contacts")
      .select("id, phone")
      .eq("organization_id", ORG_ID)
      .not("phone", "is", null);
    if (candidates) {
      const found = candidates.find(
        (c: { id: string; phone: string | null }) =>
          normalizePhone(c.phone) === lead.phone
      );
      if (found) return { id: found.id, created: false };
    }
  }

  // Create new contact
  const contactType = inferContactType(lead.industry_role);
  const warmth =
    lead.ca_executed || /executed ca|requested info/i.test(lead.level_of_interest || "")
      ? "hot"
      : /opened om|opened flyer|clicked phone|clicked email/i.test(
          lead.level_of_interest || ""
        )
      ? "warm"
      : "cold";

  const insertPayload: Record<string, unknown> = {
    organization_id: ORG_ID,
    full_name: lead.full_name_clean,
    role: lead.industry_role,
    phone: lead.phone,
    email: lead.email,
    contact_type: contactType,
    relationship_type: "prospect",
    warmth,
    city: lead.city,
    state: lead.state,
    notes: [
      lead.company ? `CREXi: ${lead.company}` : null,
      lead.notes,
    ].filter(Boolean).join("\n") || null,
  };

  const { data: created, error } = await supabase
    .from("contacts")
    .insert(insertPayload)
    .select("id")
    .single();

  if (error || !created) {
    console.error("[bulk-import] contact create failed:", error);
    return null;
  }
  return { id: created.id, created: true };
}

function inferContactType(role: string | null | undefined): string {
  if (!role) return "buyer";
  const r = role.toLowerCase();
  if (r.includes("tenant rep") || r.includes("tenant")) return "tenant";
  if (
    r.includes("listing rep") ||
    r.includes("landlord rep") ||
    r.includes("property manager")
  )
    return "broker";
  if (
    r.includes("principal investor") ||
    r.includes("private investor") ||
    r.includes("reit") ||
    r.includes("buyer rep")
  )
    return "investor";
  return "buyer";
}

/**
 * "Have we already reached out?" gate. Returns null to proceed, or a reason
 * string to skip.
 */
async function checkOutreachGate(
  supabase: any,
  contactId: string,
  propertyId: string | null
): Promise<string | null> {
  // ❶ Any sent reply for this contact + property?
  const sentQuery = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .not("final_sent_at", "is", null);
  if (propertyId) sentQuery.eq("property_id", propertyId);
  const { count: sentCount } = await sentQuery;
  if ((sentCount || 0) > 0) return "already_replied";

  // ❷ Any pending draft for this contact + property?
  const draftQuery = supabase
    .from("leads")
    .select("id, status", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .not("draft_reply", "is", null)
    .neq("status", "archived");
  if (propertyId) draftQuery.eq("property_id", propertyId);
  const { count: draftCount } = await draftQuery;
  if ((draftCount || 0) > 0) return "draft_pending";

  // ❸ Any communication in the last 7 days (any channel)?
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("communications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId)
    .gte("occurred_at", sevenDaysAgo);
  if ((recentCount || 0) > 0) return "recent_communication";

  return null; // proceed
}

// ── Pipe the activity summary into listing_metrics ───────────────────────

async function upsertActivitySummary(
  supabase: any,
  propertyId: string,
  summary: {
    page_views: number | null;
    visitors: number | null;
    opened_oms: number | null;
    executed_cas: number | null;
    offers: number | null;
    info_requests: number | null;
  }
) {
  // Use start of current ISO week as the period anchor (matches existing
  // owner-dashboard cadence).
  const now = new Date();
  const dow = now.getUTCDay();
  const diff = (dow + 6) % 7;
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - diff);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

  await supabase.from("listing_metrics").upsert(
    {
      organization_id: ORG_ID,
      property_id: propertyId,
      source: "crexi",
      period_start: weekStart.toISOString().slice(0, 10),
      period_end: weekEnd.toISOString().slice(0, 10),
      page_views: summary.page_views,
      unique_visitors: summary.visitors,
      opened_oms: summary.opened_oms,
      executed_cas: summary.executed_cas,
      offers: summary.offers ?? 0,
      // Legacy aliases for back-compat
      views: summary.page_views,
      downloads: summary.opened_oms,
      nda_executions: summary.executed_cas,
      inquiries: summary.info_requests,
      raw_payload: { source: "csv_import", summary },
      scraped_at: new Date().toISOString(),
    },
    { onConflict: "property_id,source,period_start" }
  );
}

// ── Read file from request ────────────────────────────────────────────────

async function readFileFromRequest(req: NextRequest): Promise<{ buffer: Buffer | null; filename: string | null; error?: string }> {
  const ct = req.headers.get("content-type") || "";

  if (ct.includes("multipart/form-data")) {
    try {
      const fd = await req.formData();
      const file = fd.get("file");
      if (!file || typeof (file as File).arrayBuffer !== "function") {
        return { buffer: null, filename: null, error: "form-data 'file' field missing" };
      }
      const f = file as File;
      const buf = Buffer.from(await f.arrayBuffer());
      return { buffer: buf, filename: f.name || null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { buffer: null, filename: null, error: `multipart parse failed: ${message}` };
    }
  }

  if (ct.includes("application/json")) {
    try {
      const body = (await req.json()) as { file_b64?: string; filename?: string };
      if (!body.file_b64) return { buffer: null, filename: null, error: "json body missing file_b64" };
      const buf = Buffer.from(body.file_b64, "base64");
      return { buffer: buf, filename: body.filename || null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { buffer: null, filename: null, error: `json parse failed: ${message}` };
    }
  }

  return { buffer: null, filename: null, error: `unsupported content-type: ${ct}` };
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function POST(_req: NextRequest) {
  // DEPRECATED — this legacy endpoint creates `leads` table rows with
  // source='crexi' that DUPLICATE crexi_leads_state rows, polluting the
  // Leads tab with phantom no-email entries. It was responsible for the
  // 80 phantom rows cleaned up on 2026-05-15.
  //
  // The correct CREXi ingestion path is /api/leads/crexi-report which
  // writes ONLY to crexi_leads_state. CREXi rows should never end up in
  // the `leads` table (that table is for direct inquiries — website
  // forms, forwarded emails, etc.).
  return NextResponse.json(
    {
      error: "This endpoint is deprecated. CREXi imports should use POST /api/leads/crexi-report which writes only to crexi_leads_state. The legacy bulk-import-crexi path created duplicate `leads` table rows that polluted the Leads tab.",
    },
    { status: 410 }, // Gone
  );
}

// Legacy implementation kept below for reference but unreachable.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _legacyImpl_unused(req: NextRequest) {
  const supabase = createServiceSupabase();

  // Auth
  const auth = await authKey(supabase, req.headers.get("x-extension-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  // Read knobs
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const maxRowsParam = url.searchParams.get("max");
  const maxRows = maxRowsParam ? parseInt(maxRowsParam, 10) : null;

  // Read + parse file
  const { buffer, filename, error: readErr } = await readFileFromRequest(req);
  if (readErr || !buffer) {
    return NextResponse.json({ error: readErr || "no file" }, { status: 400 });
  }

  let parsed;
  try {
    // CSV: detect via filename or content; otherwise treat as XLSX
    const isCsv =
      (filename && /\.csv$/i.test(filename)) ||
      buffer.slice(0, 200).toString("utf8").split("\n").length > 5;
    if (isCsv && filename && /\.csv$/i.test(filename)) {
      parsed = parseCrexiReport(buffer.toString("utf8"));
    } else {
      parsed = parseCrexiReport(buffer);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `parse failed: ${message}` }, { status: 400 });
  }

  // Resolve property
  const property = await resolveProperty(
    supabase,
    parsed.property_name,
    parsed.property_address
  );

  // Push activity summary into listing_metrics (skip on dry run)
  if (property && parsed.activity_summary && !dryRun) {
    try {
      await upsertActivitySummary(supabase, property.id, parsed.activity_summary);
    } catch (err) {
      console.error("[bulk-import] activity summary upsert failed:", err);
    }
  }

  // Process each lead
  const results = {
    total_rows: parsed.leads.length,
    drafted: 0,
    skipped_already_replied: 0,
    skipped_draft_pending: 0,
    skipped_recent_comms: 0,
    skipped_no_email: 0,
    new_contacts: 0,
    updated_contacts: 0,
    errors: [] as Array<{ name: string; reason: string }>,
    sample_drafts: [] as Array<{ lead_id: string; name: string; preview: string }>,
  };

  let draftedCount = 0;

  for (const lead of parsed.leads) {
    try {
      if (!lead.email && !lead.phone) {
        results.skipped_no_email += 1;
        continue;
      }

      // Resolve / create contact
      const contactResolution = await resolveContact(supabase, lead);
      if (!contactResolution) {
        results.errors.push({ name: lead.full_name_clean, reason: "contact resolution failed" });
        continue;
      }
      if (contactResolution.created) results.new_contacts += 1;
      else results.updated_contacts += 1;

      // Outreach gate (only if not dry-run)
      const gateReason = await checkOutreachGate(
        supabase,
        contactResolution.id,
        property?.id || null
      );
      if (gateReason === "already_replied") {
        results.skipped_already_replied += 1;
        continue;
      }
      if (gateReason === "draft_pending") {
        results.skipped_draft_pending += 1;
        continue;
      }
      if (gateReason === "recent_communication") {
        results.skipped_recent_comms += 1;
        continue;
      }

      // Cap drafting at maxRows if specified
      if (maxRows !== null && draftedCount >= maxRows) {
        // Still create the lead, just don't draft (so we don't lose data)
        if (!dryRun) {
          await ensureLead(supabase, contactResolution.id, property?.id || null, lead);
        }
        continue;
      }

      // Find or create lead row tied to this contact + property
      let leadId: string | null = null;
      if (!dryRun) {
        leadId = await ensureLead(supabase, contactResolution.id, property?.id || null, lead);
      } else {
        leadId = `dry-run-${results.drafted}`;
      }
      if (!leadId) {
        results.errors.push({ name: lead.full_name_clean, reason: "lead persist failed" });
        continue;
      }

      // Fire the proactive drafter (skip on dry-run)
      if (!dryRun) {
        const engagementSignal = buildEngagementSignal(lead, parsed.property_name);
        const draftResult = await draftLeadReply({
          supabase,
          organizationId: ORG_ID,
          leadId,
          tone: "proactive_engagement",
          engagementSignal,
        });
        if (draftResult.ok && draftResult.draft) {
          results.drafted += 1;
          draftedCount += 1;
          if (results.sample_drafts.length < 3) {
            results.sample_drafts.push({
              lead_id: leadId,
              name: lead.full_name_clean,
              preview: draftResult.draft.slice(0, 240),
            });
          }
        } else if (!draftResult.ok && draftResult.error) {
          results.errors.push({
            name: lead.full_name_clean,
            reason: `draft: ${draftResult.error}`,
          });
        }
      } else {
        // Dry run — just count
        results.drafted += 1;
        draftedCount += 1;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.errors.push({ name: lead.full_name_clean, reason: message });
    }
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    filename: filename || null,
    property: property
      ? { id: property.id, name: property.name }
      : { matched: false, report_property_name: parsed.property_name },
    activity_summary: parsed.activity_summary,
    warnings: parsed.warnings,
    ...results,
  });
}

// ── Lead persistence ──────────────────────────────────────────────────────

async function ensureLead(
  supabase: any,
  contactId: string,
  propertyId: string | null,
  lead: CrexiLeadRow
): Promise<string | null> {
  // Look for an existing open (non-archived) lead for this contact + property
  let query = supabase
    .from("leads")
    .select("id, status")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contactId);
  if (propertyId) query = query.eq("property_id", propertyId);
  query = query.neq("status", "archived").order("created_at", { ascending: false }).limit(1);
  const { data: existing } = await query.maybeSingle();
  if (existing) return existing.id;

  // Create
  const urgency =
    lead.ca_executed || /executed ca|requested info/i.test(lead.level_of_interest || "")
      ? "hot"
      : /opened om|opened flyer/i.test(lead.level_of_interest || "")
      ? "warm"
      : "cold";

  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contactId,
      property_id: propertyId,
      source: "crexi",
      status: "new",
      sender_name: lead.full_name_clean,
      sender_email: lead.email,
      sender_phone: lead.phone,
      property_label: null,
      urgency,
      qualifier_summary:
        `CREXi engagement: ${lead.level_of_interest || "page visit"}` +
        (lead.company ? ` · ${lead.company}` : "") +
        (lead.industry_role ? ` · ${lead.industry_role}` : "") +
        (lead.ca_executed ? " · CA EXECUTED" : ""),
      raw_subject: null,
      raw_body: JSON.stringify(
        {
          discovered_via: "crexi_csv_import",
          level_of_interest: lead.level_of_interest,
          last_action_date: lead.last_action_date,
          company: lead.company,
          industry_role: lead.industry_role,
          city: lead.city,
          state: lead.state,
          attachments: lead.attachments,
          notes: lead.notes,
          ca_executed: lead.ca_executed,
        },
        null,
        2
      ),
    })
    .select("id")
    .single();

  if (error || !created) {
    console.error("[bulk-import] lead insert failed:", error);
    return null;
  }
  return created.id;
}

function buildEngagementSignal(lead: CrexiLeadRow, propertyName: string | null): string {
  const action = lead.ca_executed
    ? "executed the Confidentiality Agreement"
    : (lead.level_of_interest || "engaged with the listing").toLowerCase();
  const where = propertyName ? ` on ${propertyName}` : "";
  const when = lead.last_action_date
    ? ` (last action ${new Date(lead.last_action_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`
    : "";
  const role =
    lead.industry_role && !/^listing rep$/i.test(lead.industry_role.trim())
      ? ` — they're listed as ${lead.industry_role}${lead.company ? ` at ${lead.company}` : ""}`
      : lead.company
      ? ` — they're at ${lead.company}`
      : "";
  return `${lead.full_name_clean} ${action}${where}${when}${role}.`;
}
