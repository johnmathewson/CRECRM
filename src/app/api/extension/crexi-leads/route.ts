/**
 * POST /api/extension/crexi-leads
 *
 * Receives a batch of CREXi leads scraped by the extension's leads
 * watcher. The extension does the heavy DOM work; this endpoint owns
 * the persistence + de-duplication + event-appending logic.
 *
 * Pipeline per lead in the payload:
 *   1. Resolve to existing contact (match by lower(email) → fall back to phone)
 *      or create one. Email is canonical; phone is the fallback identity.
 *   2. Resolve to existing lead for this (contact, property) pair, or create
 *      one with source="crexi". A "lead" represents an inquiry, so a single
 *      contact can have multiple leads if they engage with multiple listings.
 *   3. Upsert crexi_leads_state for the (property, name+email) identity. Diff
 *      against the prior level_of_interest / number_of_visits to decide what
 *      events to append.
 *   4. Append lead_events:
 *        - crexi_lead_discovered  (first time we've ever seen this person)
 *        - crexi_engagement       (level_of_interest moved up the funnel)
 *        - crexi_visit_increased  (number_of_visits rose without status change)
 *
 * Return shape: { ok, processed, new_contacts, new_leads, new_events,
 *                 lead_ids_with_new_engagement }
 *
 * Auth: x-extension-key header.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID, hashSecret } from "@/lib/owner-dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── CORS ──────────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-extension-key",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// ── Types ─────────────────────────────────────────────────────────────────

interface ActivityEntry {
  action: string;          // "Opened OM", "Executed CA", "Visited Page", etc.
  occurred_at?: string;    // ISO timestamp if we could derive one (relative-time often)
  occurred_label?: string; // "4 hours ago" etc., as fallback
  listing_label?: string;  // "Liberty Square Retail Center"
}

interface InboundLead {
  // Identity (always present from list view)
  name: string;
  phone?: string | null;
  // Optional list-view fields
  company?: string | null;
  role?: string | null;
  number_of_visits?: number | null;
  level_of_interest?: string | null;
  last_activity_label?: string | null;     // "May 04, 2026" / "4 hours ago"
  last_activity_at?: string | null;        // ISO if parseable
  // Side-panel fields (only present on deep scrape)
  email?: string | null;
  buyer_evaluation?: Record<string, unknown> | null;
  activity_timeline?: ActivityEntry[] | null;
  // Per-row provenance
  source_url?: string | null;              // The dashboard URL we read this from
}

interface CrexiLeadsBody {
  source: "crexi";
  property_id?: string | null;             // CRM property UUID (preferred)
  crexi_listing_id?: string | null;        // CREXi numeric ID (fallback to look up)
  scraped_at?: string;                     // ISO; defaults to now
  leads: InboundLead[];
  raw?: unknown;                           // Optional debug payload
}

// ── Funnel-stage ordering ─────────────────────────────────────────────────
// We rank "level of interest" so we can detect funnel ADVANCEMENT (not just
// any change). Going from "Visited Page" → "Executed CA" is interesting;
// going the other direction would be a stale state we ignore.

const FUNNEL_RANK: Record<string, number> = {
  "saved property": 1,
  "visited page": 2,
  "printed page": 2,
  "clicked phone": 3,
  "clicked email": 3,
  "opened flyer": 4,
  "opened om": 5,
  "downloaded dd": 5,
  "requested info": 6,
  "executed ca": 7,
  "calculated valuation": 7,
};

function rankOf(s: string | null | undefined): number {
  if (!s) return 0;
  return FUNNEL_RANK[s.toLowerCase().trim()] ?? 0;
}

// Map CREXi role pills to one of the contact_type enum values
// (allowed: owner, buyer, tenant, investor, lender, attorney, broker, other).
function inferContactType(role: string | null | undefined): string {
  if (!role) return "buyer"; // CREXi is mostly buy-side; safest default
  const r = role.toLowerCase();
  if (r.includes("tenant rep")) return "tenant";
  if (r.includes("listing rep") || r.includes("landlord rep") || r.includes("property manager")) return "broker";
  if (r.includes("principal investor") || r.includes("private investor") || r.includes("reit")) return "investor";
  if (r.includes("buyer rep")) return "buyer";
  return "buyer";
}

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
  // Fire-and-forget last-used bump
  supabase
    .from("extension_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => null);
  return { ok: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizeEmail(e?: string | null): string | null {
  if (!e) return null;
  const trimmed = e.trim().toLowerCase();
  return trimmed && trimmed.includes("@") ? trimmed : null;
}

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  // Keep digits only. CREXi shows "317.617.4900" → "3176174900"
  const digits = p.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function nameParts(n: string): { first: string; last: string } {
  const parts = n.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const auth = await authKey(supabase, req.headers.get("x-extension-key"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401, headers: corsHeaders() });
  }

  let body: CrexiLeadsBody;
  try {
    body = (await req.json()) as CrexiLeadsBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers: corsHeaders() }
    );
  }

  if (!Array.isArray(body.leads)) {
    return NextResponse.json(
      { error: "leads must be an array" },
      { status: 400, headers: corsHeaders() }
    );
  }

  // ── Resolve property ────────────────────────────────────────────────────
  let propertyId = body.property_id || null;
  let crexiListingId = body.crexi_listing_id || null;

  if (!propertyId && crexiListingId) {
    const { data } = await supabase
      .from("properties")
      .select("id, crexi_listing_id")
      .eq("organization_id", ORG_ID)
      .eq("crexi_listing_id", crexiListingId)
      .maybeSingle();
    if (data) propertyId = data.id;
  } else if (propertyId && !crexiListingId) {
    const { data } = await supabase
      .from("properties")
      .select("crexi_listing_id")
      .eq("id", propertyId)
      .maybeSingle();
    if (data?.crexi_listing_id) crexiListingId = data.crexi_listing_id;
  }

  if (!propertyId || !crexiListingId) {
    return NextResponse.json(
      {
        error:
          "Couldn't resolve the property. Pass property_id (CRM UUID) or crexi_listing_id (the numeric ID from the URL), and make sure that property exists in the CRM.",
      },
      { status: 400, headers: corsHeaders() }
    );
  }

  // ── Per-lead processing ────────────────────────────────────────────────
  const stats = {
    processed: 0,
    new_contacts: 0,
    updated_contacts: 0,
    new_leads: 0,
    new_events: 0,
    skipped: 0,
  };
  const hotLeadIds: string[] = []; // Lead IDs whose engagement advanced this poll
  const errors: Array<{ name: string; reason: string }> = [];

  for (const lead of body.leads) {
    try {
      if (!lead.name || lead.name.trim().length < 2) {
        stats.skipped += 1;
        continue;
      }

      const email = normalizeEmail(lead.email);
      const phone = normalizePhone(lead.phone);

      // ── 1. Find or create contact ─────────────────────────────────────
      let contactId: string | null = null;
      let contactCreated = false;

      // Try email first (canonical), then phone
      if (email) {
        const { data: byEmail } = await supabase
          .from("contacts")
          .select("id")
          .eq("organization_id", ORG_ID)
          .ilike("email", email)
          .maybeSingle();
        if (byEmail) contactId = byEmail.id;
      }
      if (!contactId && phone) {
        // Phone in the DB is stored as raw "317.617.4900" / "(317) 617-4900"
        // / etc. depending on what the original entry came in as. SQL ilike
        // doesn't help across formats, so we pull candidates and compare
        // normalized digits in JS. For an org's contact list (~hundreds),
        // this is fast enough.
        const { data: candidates } = await supabase
          .from("contacts")
          .select("id, phone")
          .eq("organization_id", ORG_ID)
          .not("phone", "is", null);
        if (candidates) {
          const found = candidates.find(
            (c: { id: string; phone: string | null }) =>
              normalizePhone(c.phone) === phone
          );
          if (found) contactId = found.id;
        }
      }

      if (!contactId) {
        // Create new contact. contact_type must be one of the enum values
        // (no "prospect" — that's relationship_type, not contact_type).
        const insertPayload: Record<string, unknown> = {
          organization_id: ORG_ID,
          full_name: lead.name.trim(),
          role: lead.role || null,
          phone: lead.phone || null,
          email: email,
          contact_type: inferContactType(lead.role),
          relationship_type: "prospect",
          warmth: rankOf(lead.level_of_interest) >= 5 ? "hot" : "warm",
          notes: lead.company ? `CREXi: ${lead.company}` : null,
        };
        const { data: created, error: createErr } = await supabase
          .from("contacts")
          .insert(insertPayload)
          .select("id")
          .single();
        if (createErr || !created) {
          errors.push({ name: lead.name, reason: createErr?.message || "contact insert failed" });
          continue;
        }
        contactId = created.id;
        contactCreated = true;
        stats.new_contacts += 1;
      } else {
        // Backfill email/phone if we have new info
        const updates: Record<string, unknown> = {};
        if (email) {
          const { data: existing } = await supabase
            .from("contacts").select("email, phone").eq("id", contactId).maybeSingle();
          if (existing && !existing.email) updates.email = email;
          if (existing && !existing.phone && lead.phone) updates.phone = lead.phone;
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from("contacts").update(updates).eq("id", contactId);
          stats.updated_contacts += 1;
        }
      }

      // ── 2. Find or create lead for (contact, property) ────────────────
      let leadId: string | null = null;
      let leadCreated = false;
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id, status")
        .eq("organization_id", ORG_ID)
        .eq("contact_id", contactId)
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingLead) {
        leadId = existingLead.id;
      } else {
        // source must be one of the leads_source_check enum values.
        // "crexi" is the canonical source for any CREXi-discovered lead;
        // funnel stage detail goes into urgency + qualifier_summary.
        const { data: createdLead, error: leadErr } = await supabase
          .from("leads")
          .insert({
            organization_id: ORG_ID,
            contact_id: contactId,
            property_id: propertyId,
            source: "crexi",
            status: "new",
            sender_name: lead.name.trim(),
            sender_email: email,
            sender_phone: lead.phone || null,
            property_label: null,
            urgency: rankOf(lead.level_of_interest) >= 7 ? "hot"
                   : rankOf(lead.level_of_interest) >= 5 ? "warm"
                   : "cold",
            qualifier_summary:
              `CREXi engagement: ${lead.level_of_interest || "page visit"}` +
              (lead.company ? ` · ${lead.company}` : "") +
              (lead.role ? ` · ${lead.role}` : ""),
            raw_body: JSON.stringify(
              {
                discovered_via: "crexi-leads-watcher",
                level_of_interest: lead.level_of_interest,
                number_of_visits: lead.number_of_visits,
                activity_timeline: lead.activity_timeline,
                buyer_evaluation: lead.buyer_evaluation,
              },
              null,
              2
            ),
          })
          .select("id")
          .single();
        if (leadErr || !createdLead) {
          errors.push({ name: lead.name, reason: leadErr?.message || "lead insert failed" });
          continue;
        }
        leadId = createdLead.id;
        leadCreated = true;
        stats.new_leads += 1;
      }

      // ── 3. Upsert crexi_leads_state + diff ────────────────────────────
      //
      // CRITICAL: when the extension scrapes a row WITHOUT email (CREXi's
      // table view doesn't expose email — it's only behind the detail
      // panel), we must NOT create a new ghost row if the person already
      // exists with an email. The old code did `.ilike("email", email || "")`
      // which couldn't match an existing row whose email was not empty
      // string. Result: dozens of duplicate no-email "ghost" rows every
      // time the user browsed CREXi. Fixed by matching by name only when
      // no email is scraped, and PRESERVING existing email/phone/role on
      // update so the scrape never wipes good data.
      let prior: {
        id: string;
        email?: string | null;
        phone?: string | null;
        company?: string | null;
        role?: string | null;
        level_of_interest?: string | null;
        number_of_visits?: number | null;
        contact_id?: string | null;
        lead_id?: string | null;
        raw_panel?: Record<string, unknown> | null;
      } | null = null;

      if (email) {
        // We have an email — exact-match by (property, name, email)
        const { data } = await supabase
          .from("crexi_leads_state")
          .select("id, email, phone, company, role, level_of_interest, number_of_visits, contact_id, lead_id, raw_panel")
          .eq("property_id", propertyId)
          .ilike("name", lead.name.trim())
          .ilike("email", email)
          .maybeSingle();
        prior = data;
        // If no email-keyed match, ALSO check by name only (in case the
        // existing row is a no-email ghost we want to backfill).
        if (!prior) {
          const { data: ghosts } = await supabase
            .from("crexi_leads_state")
            .select("id, email, phone, company, role, level_of_interest, number_of_visits, contact_id, lead_id, raw_panel")
            .eq("property_id", propertyId)
            .ilike("name", lead.name.trim())
            .is("email", null);
          prior = (ghosts && ghosts[0]) ?? null;
        }
      } else {
        // No email scraped — find ANY existing row for this name on this
        // property. Prefer the email-bearing one so we don't ghost-overwrite.
        const { data: candidates } = await supabase
          .from("crexi_leads_state")
          .select("id, email, phone, company, role, level_of_interest, number_of_visits, contact_id, lead_id, raw_panel")
          .eq("property_id", propertyId)
          .ilike("name", lead.name.trim());
        if (candidates && candidates.length > 0) {
          prior = candidates.find((c) => c.email) ?? candidates[0];
        }
      }

      const priorRank = rankOf(prior?.level_of_interest);
      const currRank = rankOf(lead.level_of_interest);
      const priorVisits = prior?.number_of_visits ?? 0;
      const currVisits = lead.number_of_visits ?? 0;

      // COALESCE semantics: the scrape only adds info, never wipes it.
      // If a field exists on the prior row and the scrape didn't capture
      // it, keep the prior value.
      const statePayload = {
        organization_id: ORG_ID,
        property_id: propertyId,
        crexi_listing_id: crexiListingId,
        name: lead.name.trim(),
        email: email ?? prior?.email ?? null,
        phone: lead.phone || prior?.phone || null,
        company: lead.company || prior?.company || null,
        role: lead.role || prior?.role || null,
        level_of_interest: currRank >= priorRank
          ? (lead.level_of_interest || prior?.level_of_interest || null)
          : (prior?.level_of_interest || null),
        number_of_visits: Math.max(currVisits, priorVisits) || null,
        last_activity_date: lead.last_activity_at || null,
        contact_id: contactId,
        lead_id: leadId,
        last_seen_at: new Date().toISOString(),
        last_panel_scrape_at: lead.email ? new Date().toISOString() : prior?.raw_panel ? new Date().toISOString() : null,
        raw_panel: lead.activity_timeline || lead.buyer_evaluation
          ? { activity_timeline: lead.activity_timeline, buyer_evaluation: lead.buyer_evaluation }
          : prior?.raw_panel || null,
      };

      if (prior) {
        await supabase.from("crexi_leads_state").update(statePayload).eq("id", prior.id);
      } else {
        await supabase.from("crexi_leads_state").insert(statePayload);
      }

      // ── 4. Append lead_events for what changed ────────────────────────
      const eventInserts: Array<Record<string, unknown>> = [];

      if (leadCreated) {
        eventInserts.push({
          organization_id: ORG_ID,
          lead_id: leadId,
          event_type: "crexi_lead_discovered",
          actor: "agent",
          summary:
            `Discovered on CREXi: ${lead.name}` +
            (lead.company ? ` (${lead.company})` : "") +
            (lead.level_of_interest ? ` — ${lead.level_of_interest}` : ""),
          metadata: {
            source: "crexi_leads_watcher",
            level_of_interest: lead.level_of_interest,
            number_of_visits: lead.number_of_visits,
            email: email,
            phone: lead.phone,
            company: lead.company,
            role: lead.role,
            activity_timeline: lead.activity_timeline,
            buyer_evaluation: lead.buyer_evaluation,
          },
          occurred_at: new Date().toISOString(),
        });
      } else if (currRank > priorRank) {
        // Funnel advanced
        eventInserts.push({
          organization_id: ORG_ID,
          lead_id: leadId,
          event_type: "crexi_engagement",
          actor: "agent",
          summary:
            `${lead.name}: ${prior?.level_of_interest || "(new)"} → ${lead.level_of_interest}`,
          metadata: {
            source: "crexi_leads_watcher",
            from: prior?.level_of_interest || null,
            to: lead.level_of_interest,
            number_of_visits: lead.number_of_visits,
            activity_timeline: lead.activity_timeline,
          },
          occurred_at: new Date().toISOString(),
        });
        if (currRank >= 5) hotLeadIds.push(leadId!);
      } else if (currVisits > priorVisits) {
        eventInserts.push({
          organization_id: ORG_ID,
          lead_id: leadId,
          event_type: "crexi_visit_increased",
          actor: "agent",
          summary: `${lead.name} visited again (${priorVisits} → ${currVisits} visits)`,
          metadata: {
            source: "crexi_leads_watcher",
            from_visits: priorVisits,
            to_visits: currVisits,
            level_of_interest: lead.level_of_interest,
          },
          occurred_at: new Date().toISOString(),
        });
      }

      if (eventInserts.length > 0) {
        const { error: evErr } = await supabase.from("lead_events").insert(eventInserts);
        if (!evErr) stats.new_events += eventInserts.length;
      }

      stats.processed += 1;
    } catch (err: any) {
      errors.push({ name: lead.name, reason: err?.message || String(err) });
    }
  }

  // If we got leads but couldn't process ANY of them, that's a hard failure
  // (likely a constraint or schema issue). Return 422 so the extension can
  // show the error rather than silently report success.
  const totalSent = body.leads.length;
  if (totalSent > 0 && stats.processed === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `0 of ${totalSent} leads processed — see errors[] for details`,
        property_id: propertyId,
        crexi_listing_id: crexiListingId,
        ...stats,
        errors,
      },
      { status: 422, headers: corsHeaders() }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      property_id: propertyId,
      crexi_listing_id: crexiListingId,
      ...stats,
      hot_lead_ids: hotLeadIds,
      errors: errors.length > 0 ? errors : undefined,
    },
    { headers: corsHeaders() }
  );
}
