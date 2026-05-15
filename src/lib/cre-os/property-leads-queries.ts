/**
 * Property Leads queries — consolidated view of every person who's shown
 * interest in a specific listing, across all inbound sources:
 *
 *   • crexi_leads_state — Crexi watchers + daily-report leads (the big pile)
 *   • leads — direct inquiries (website forms, forwarded emails)
 *   • nda_signatures — people who signed an NDA + got vault access
 *   • vault_access_logs — who actually opened the docs after signing
 *
 * Deduped by email (case-insensitive), then by phone, then by name. The
 * "Responded?" flag is computed by checking communications.direction='outbound'
 * for any message addressed to that lead's email.
 *
 * Also exposes the most recent Crexi activity-summary metrics for the
 * property (page views, OMs opened, CAs executed, etc.) — pulled from
 * the latest crexi_lead_report import_jobs.error_log payload.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export type LeadInterestLevel =
  | "executed_ca"      // Signed NDA on Crexi
  | "offer_submitted"
  | "info_request"
  | "downloaded_om"
  | "visited"
  | "unknown";

export type LeadSourceTag = "crexi" | "website" | "email" | "nda_vault" | "direct";

export interface PropertyLead {
  /** Synthetic ID — prefer the crexi_leads_state.id when present, else leads.id */
  id: string;
  source: LeadSourceTag;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  /** Normalized interest level — derived from level_of_interest or NDA presence */
  interest: LeadInterestLevel;
  /** Raw level_of_interest string from CREXi (e.g. "Executed CA", "Viewed") */
  interestRaw: string | null;
  /** How many times they've engaged */
  visitCount: number | null;
  /** Crexi-side lead score, if present */
  leadScore: number | null;
  /** Most recent engagement timestamp */
  lastActivityAt: string | null;
  /** First-seen timestamp */
  firstSeenAt: string | null;
  /** Has any outbound communication been sent to this email?
   *  DEPRECATED — use lastTouchedAt going forward. Kept for back-compat with
   *  existing UI code that references respondedAt. Set to same value as
   *  lastTouchedAt by the loader. */
  respondedAt: string | null;
  /** When did we last send an outbound email to this lead? (renamed from
   *  respondedAt for clarity — it was always about OUR outbound, not their reply) */
  lastTouchedAt: string | null;
  /** When did THIS lead actually reply to one of our outbound touches?
   *  Pulled from lane_touches.status='responded' rows matched by contact_id. */
  repliedAt: string | null;
  /** If this lead's email was touched on a DIFFERENT property recently,
   *  surface that here so the broker doesn't accidentally double-email.
   *  Null = not touched elsewhere recently. */
  crossPropertyTouch: { propertyName: string; at: string } | null;
  /** Whether they signed an NDA */
  signedNda: boolean;
  /** Aggregate vault visits */
  vaultVisits: number;
  /** Free-form Crexi notes / qualification data */
  notes: string | null;
}

export interface PropertyLeadActivitySummary {
  pageViews: number | null;
  visitors: number | null;
  openedOmsFlyers: number | null;
  executedCas: number | null;
  offers: number | null;
  infoRequests: number | null;
  /** When the last report was processed */
  reportFreshAt: string | null;
}

export interface PropertyLeadsSnapshot {
  activity: PropertyLeadActivitySummary;
  leads: PropertyLead[];
  /** Aggregates for the panel header */
  totals: {
    leadCount: number;
    withEmail: number;
    withPhone: number;
    hotActions: number; // Executed CA + Offer + Info Request
    awaitingResponse: number; // hot but no outbound yet
  };
}

// ── Loader ────────────────────────────────────────────────────────────────

const HOT_LEVELS = new Set([
  "executed_ca",
  "offer_submitted",
  "info_request",
]);

function normalizeInterest(s: string | null | undefined): LeadInterestLevel {
  if (!s) return "unknown";
  const v = s.toLowerCase();
  if (v.includes("executed") && v.includes("ca")) return "executed_ca";
  if (v.includes("offer")) return "offer_submitted";
  if (v.includes("info") && v.includes("request")) return "info_request";
  if (v.includes("downloaded") || v.includes("opened")) return "downloaded_om";
  if (v.includes("view")) return "visited";
  return "unknown";
}

export async function loadPropertyLeads(propertyId: string): Promise<PropertyLeadsSnapshot> {
  const sb = createServerSupabase();

  const [crexiRes, leadsRes, ndaRes, vaultRes, latestReportRes, outboundRes, inboundRepliesRes, sentTouchesRes, crossPropCommsRes, crossPropLaneRes] = await Promise.all([
    sb.from("crexi_leads_state")
      .select("id, name, email, phone, company, role, level_of_interest, number_of_visits, last_activity_date, first_seen_at, raw_panel, contact_id")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .order("last_activity_date", { ascending: false, nullsFirst: false }),

    sb.from("leads")
      .select("id, sender_name, sender_email, sender_phone, urgency, status, qualifier_summary, source, auto_ack_sent_at, final_sent_at, created_at, updated_at, raw_body")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false }),

    sb.from("nda_signatures")
      .select("id, typed_name, typed_email, signed_at, revoked_at")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId),

    sb.from("vault_access_logs")
      .select("contact_id, lead_id, access_type, accessed_at")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId),

    sb.from("import_jobs")
      .select("error_log, completed_at, source_detail")
      .eq("organization_id", ORG_ID)
      .eq("source", "crexi_lead_report")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(20),

    // Outbound communications targeting this property — used to compute the
    // "Responded?" flag per lead by email match.
    sb.from("communications")
      .select("to_addresses, occurred_at")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .eq("direction", "outbound"),

    // Inbound replies — lane_touches with status='responded' for this property.
    // Matched to leads by contact_id (set during CREXi → contacts linkage) OR
    // by from_email in metadata (when contact_id is NULL — happens when the
    // reply matched via communications source which doesn't carry contact_id).
    sb.from("lane_touches")
      .select("contact_id, responded_at, metadata")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .eq("status", "responded")
      .order("responded_at", { ascending: false }),

    // Outbound sends via /api/lane-touches/send (the Compose dialog path).
    // These write to lane_touches but historically NOT to communications,
    // so we have to query both to get a complete lastTouchedAt picture.
    // Match by metadata.to (email) since lane_touches doesn't have
    // to_addresses like communications does.
    sb.from("lane_touches")
      .select("contact_id, sent_at, metadata")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .eq("status", "sent")
      .order("sent_at", { ascending: false }),

    // CROSS-PROPERTY touches — outbound communications + lane_touches sent
    // about OTHER properties in the last 30 days. Surfaces a warning on
    // each lead row so the broker doesn't double-email someone about
    // Liberty Square if we already emailed them about Super 8.
    sb.from("communications")
      .select("to_addresses, occurred_at, property_id, property:properties(name)")
      .eq("organization_id", ORG_ID)
      .eq("direction", "outbound")
      .neq("property_id", propertyId)
      .gte("occurred_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
    sb.from("lane_touches")
      .select("metadata, sent_at, property_id, property:properties(name)")
      .eq("organization_id", ORG_ID)
      .eq("status", "sent")
      .neq("property_id", propertyId)
      .gte("sent_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
  ]);

  // ── Build the email → lastTouchedAt map (outbound we sent) ──
  // Combined from TWO sources:
  //   1. communications (direction=outbound, to_addresses jsonb)
  //   2. lane_touches (status=sent, metadata.to = email) — Compose path
  // We take the max across both since they may not be in sync.
  const respondedByEmail = new Map<string, string>();
  // Also build a contact_id → lastTouchedAt map (covers leads keyed by
  // contact rather than email; e.g. when Compose was sent to a phone)
  const touchedByContactId = new Map<string, string>();

  for (const c of (outboundRes.data ?? []) as Array<{ to_addresses: string[] | null; occurred_at: string }>) {
    for (const addr of c.to_addresses ?? []) {
      const e = addr.toLowerCase().trim();
      const prev = respondedByEmail.get(e);
      if (!prev || c.occurred_at > prev) respondedByEmail.set(e, c.occurred_at);
    }
  }
  for (const t of (sentTouchesRes.data ?? []) as Array<{ contact_id: string | null; sent_at: string | null; metadata: Record<string, unknown> | null }>) {
    if (!t.sent_at) continue;
    // Email key: lane_touches.metadata.to is the recipient email for Compose
    const toEmail = ((t.metadata?.to as string) ?? "").toLowerCase().trim();
    if (toEmail) {
      const prev = respondedByEmail.get(toEmail);
      if (!prev || t.sent_at > prev) respondedByEmail.set(toEmail, t.sent_at);
    }
    // Contact-id key for leads matched via contact_id rather than email
    if (t.contact_id) {
      const prev = touchedByContactId.get(t.contact_id);
      if (!prev || t.sent_at > prev) touchedByContactId.set(t.contact_id, t.sent_at);
    }
  }

  // ── Build the email → cross-property touch map ──
  // For each email touched on a DIFFERENT property recently, record when
  // and on which property. Surfaces a warning chip on the lead's row.
  const crossPropByEmail = new Map<string, { propertyName: string; at: string }>();
  // Supabase nested foreign join returns `property` as either an array or
  // an object depending on cardinality — normalize both shapes here.
  type Joined = { name?: string | null } | Array<{ name?: string | null }> | null | undefined;
  const propName = (joined: Joined): string => {
    if (!joined) return "(another listing)";
    if (Array.isArray(joined)) return joined[0]?.name ?? "(another listing)";
    return joined.name ?? "(another listing)";
  };
  for (const c of (crossPropCommsRes.data ?? []) as Array<{
    to_addresses: string[] | null;
    occurred_at: string;
    property: Joined;
  }>) {
    const pname = propName(c.property);
    for (const addr of c.to_addresses ?? []) {
      const e = addr.toLowerCase().trim();
      const prev = crossPropByEmail.get(e);
      if (!prev || c.occurred_at > prev.at) {
        crossPropByEmail.set(e, { propertyName: pname, at: c.occurred_at });
      }
    }
  }
  for (const t of (crossPropLaneRes.data ?? []) as Array<{
    metadata: Record<string, unknown> | null;
    sent_at: string | null;
    property: Joined;
  }>) {
    if (!t.sent_at) continue;
    const toEmail = ((t.metadata?.to as string) ?? "").toLowerCase().trim();
    if (!toEmail) continue;
    const pname = propName(t.property);
    const prev = crossPropByEmail.get(toEmail);
    if (!prev || t.sent_at > prev.at) {
      crossPropByEmail.set(toEmail, { propertyName: pname, at: t.sent_at });
    }
  }

  // ── Build the contact_id → repliedAt AND email → repliedAt maps ──
  // Two indexes because reply touches don't always carry a contact_id:
  // when the reply matched a parent via communications (the bulk-ai-followup
  // write path), match-reply-to-touch sets contact_id = NULL. We fall back
  // to from_email in metadata so those replies still surface on the Leads tab.
  const repliedByContactId = new Map<string, string>();
  const repliedByEmail = new Map<string, string>();
  for (const r of (inboundRepliesRes.data ?? []) as Array<{
    contact_id: string | null;
    responded_at: string | null;
    metadata: Record<string, unknown> | null;
  }>) {
    if (!r.responded_at) continue;
    if (r.contact_id) {
      const prev = repliedByContactId.get(r.contact_id);
      if (!prev || r.responded_at > prev) repliedByContactId.set(r.contact_id, r.responded_at);
    }
    const fromEmail = ((r.metadata?.from_email as string) ?? "").toLowerCase().trim();
    if (fromEmail) {
      const prev = repliedByEmail.get(fromEmail);
      if (!prev || r.responded_at > prev) repliedByEmail.set(fromEmail, r.responded_at);
    }
  }

  // ── NDA signers by email ──
  const ndaByEmail = new Map<string, { signedAt: string }>();
  for (const n of (ndaRes.data ?? []) as Array<{ typed_email: string | null; signed_at: string }>) {
    if (n.typed_email) ndaByEmail.set(n.typed_email.toLowerCase(), { signedAt: n.signed_at });
  }

  // ── Vault visits — count by lead_id and contact_id (approximate; group later) ──
  const vaultByLead = new Map<string, number>();
  for (const v of (vaultRes.data ?? []) as Array<{ lead_id: string | null }>) {
    if (v.lead_id) vaultByLead.set(v.lead_id, (vaultByLead.get(v.lead_id) ?? 0) + 1);
  }

  // ── Activity summary — from the latest crexi_lead_report import_jobs row for this property ──
  let activity: PropertyLeadActivitySummary = {
    pageViews: null, visitors: null, openedOmsFlyers: null,
    executedCas: null, offers: null, infoRequests: null,
    reportFreshAt: null,
  };
  for (const j of (latestReportRes.data ?? []) as Array<{ error_log: { property?: { id?: string }; activity?: Record<string, number> } | null; completed_at: string }>) {
    if (j.error_log?.property?.id === propertyId) {
      const a = j.error_log.activity || {};
      activity = {
        pageViews: a.pageViews ?? null,
        visitors: a.visitors ?? null,
        openedOmsFlyers: a.openedOmsFlyers ?? null,
        executedCas: a.executedCas ?? null,
        offers: a.offers ?? null,
        infoRequests: a.infoRequests ?? null,
        reportFreshAt: j.completed_at,
      };
      break;
    }
  }

  // ── Build deduped lead list ──
  // Strategy: start with crexi_leads_state (richest data), then layer in
  // direct leads + NDA signers if they're not already present (matched by email).
  const byEmail = new Map<string, PropertyLead>();
  const byNameAndPhone = new Map<string, PropertyLead>();

  function addLead(lead: PropertyLead) {
    const emailKey = lead.email?.toLowerCase().trim();
    if (emailKey) {
      const existing = byEmail.get(emailKey);
      if (existing) {
        // Merge — prefer more-complete fields
        existing.phone = existing.phone ?? lead.phone;
        existing.company = existing.company ?? lead.company;
        existing.role = existing.role ?? lead.role;
        existing.signedNda = existing.signedNda || lead.signedNda;
        existing.vaultVisits = Math.max(existing.vaultVisits, lead.vaultVisits);
        if (lead.lastActivityAt && (!existing.lastActivityAt || lead.lastActivityAt > existing.lastActivityAt)) {
          existing.lastActivityAt = lead.lastActivityAt;
        }
        if (lead.respondedAt && (!existing.respondedAt || lead.respondedAt > existing.respondedAt)) {
          existing.respondedAt = lead.respondedAt;
        }
        return;
      }
      byEmail.set(emailKey, lead);
      return;
    }
    // No email — first check if an already-added has-email row has the
    // SAME NAME. If so, merge into that row (this is the case where a
    // CREXi row has the canonical email + a leads-table row for the same
    // person has no email — we want to surface them as ONE row, not two).
    const nameLc = lead.name.toLowerCase().trim();
    if (nameLc && nameLc !== "(unknown)") {
      for (const existing of Array.from(byEmail.values())) {
        if (existing.name.toLowerCase().trim() === nameLc) {
          // Merge non-conflicting fields into the email-bearing row
          existing.phone = existing.phone ?? lead.phone;
          existing.company = existing.company ?? lead.company;
          existing.role = existing.role ?? lead.role;
          existing.signedNda = existing.signedNda || lead.signedNda;
          existing.vaultVisits = Math.max(existing.vaultVisits, lead.vaultVisits);
          if (lead.lastActivityAt && (!existing.lastActivityAt || lead.lastActivityAt > existing.lastActivityAt)) {
            existing.lastActivityAt = lead.lastActivityAt;
          }
          if (lead.respondedAt && (!existing.respondedAt || lead.respondedAt > existing.respondedAt)) {
            existing.respondedAt = lead.respondedAt;
          }
          return;
        }
      }
    }
    // Still no email match — dedupe by name + phone within the no-email bucket
    const key = `${nameLc}::${lead.phone ?? ""}`;
    if (!byNameAndPhone.has(key)) byNameAndPhone.set(key, lead);
  }

  // CREXi state rows
  for (const c of (crexiRes.data ?? []) as Array<{
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    role: string | null;
    level_of_interest: string | null;
    number_of_visits: number | null;
    last_activity_date: string | null;
    first_seen_at: string | null;
    raw_panel: { "Crexi Lead Score"?: number; "Note 1"?: string; "Note 2"?: string; "Note 3"?: string } | null;
    contact_id: string | null;
  }>) {
    const email = c.email?.toLowerCase().trim() ?? null;
    const raw = c.raw_panel || {};
    const notes = [raw["Note 1"], raw["Note 2"], raw["Note 3"]].filter(Boolean).join("\n\n") || null;
    const interest = normalizeInterest(c.level_of_interest);
    // lastTouchedAt: max of email-keyed and contact-keyed touches (covers
    // both the communications path and the lane_touches/Compose path)
    const byEmailVal = email ? respondedByEmail.get(email) ?? null : null;
    const byContactVal = c.contact_id ? touchedByContactId.get(c.contact_id) ?? null : null;
    const lastTouchedAt = (byEmailVal && byContactVal)
      ? (byEmailVal > byContactVal ? byEmailVal : byContactVal)
      : (byEmailVal ?? byContactVal);
    // Replied lookup: try contact_id first (when set), fall back to email
    // (covers replies that matched via communications source where contact_id
    // is NULL on the lane_touch).
    const byContactRepl = c.contact_id ? repliedByContactId.get(c.contact_id) : null;
    const byEmailRepl = email ? repliedByEmail.get(email) : null;
    const repliedAt = (byContactRepl && byEmailRepl)
      ? (byContactRepl > byEmailRepl ? byContactRepl : byEmailRepl)
      : (byContactRepl ?? byEmailRepl ?? null);
    const crossPropertyTouch = email ? crossPropByEmail.get(email) ?? null : null;
    const signedNda = email ? ndaByEmail.has(email) : false;
    addLead({
      id: c.id,
      source: "crexi",
      name: c.name ?? "(unknown)",
      email,
      phone: c.phone,
      company: c.company,
      role: c.role,
      interest,
      interestRaw: c.level_of_interest,
      visitCount: c.number_of_visits,
      leadScore: raw["Crexi Lead Score"] ?? null,
      lastActivityAt: c.last_activity_date,
      firstSeenAt: c.first_seen_at,
      respondedAt: lastTouchedAt, // back-compat alias
      lastTouchedAt,
      repliedAt,
      crossPropertyTouch,
      signedNda,
      vaultVisits: 0,
      notes,
    });
  }

  // Direct leads (email inquiries)
  for (const l of (leadsRes.data ?? []) as Array<{
    id: string;
    sender_name: string | null;
    sender_email: string | null;
    sender_phone: string | null;
    urgency: string | null;
    status: string | null;
    qualifier_summary: string | null;
    source: string | null;
    final_sent_at: string | null;
    created_at: string;
    updated_at: string;
    raw_body: string | null;
  }>) {
    const email = l.sender_email?.toLowerCase().trim() ?? null;
    if (!email && !l.sender_name) continue; // unparseable
    const lastTouchedAt = email ? respondedByEmail.get(email) ?? l.final_sent_at ?? null : l.final_sent_at;
    const signedNda = email ? ndaByEmail.has(email) : false;
    addLead({
      id: l.id,
      source: (l.source as LeadSourceTag) || "email",
      name: l.sender_name ?? "(unknown)",
      email,
      phone: l.sender_phone,
      company: null,
      role: null,
      interest: l.urgency === "hot" ? "info_request" : "unknown",
      interestRaw: l.qualifier_summary,
      visitCount: null,
      leadScore: null,
      lastActivityAt: l.updated_at,
      firstSeenAt: l.created_at,
      respondedAt: lastTouchedAt, // back-compat alias
      lastTouchedAt,
      repliedAt: null, // direct leads from /api/leads/intake don't track inbound replies the same way
      crossPropertyTouch: email ? crossPropByEmail.get(email) ?? null : null,
      signedNda,
      vaultVisits: vaultByLead.get(l.id) ?? 0,
      notes: l.qualifier_summary,
    });
  }

  // NDA signers not already in either list
  for (const n of (ndaRes.data ?? []) as Array<{ id: string; typed_name: string | null; typed_email: string | null; signed_at: string; revoked_at: string | null }>) {
    const email = n.typed_email?.toLowerCase().trim() ?? null;
    if (email && byEmail.has(email)) continue;
    if (!email && !n.typed_name) continue;
    const lastTouchedAt = email ? respondedByEmail.get(email) ?? null : null;
    addLead({
      id: `nda-${n.id}`,
      source: "nda_vault",
      name: n.typed_name ?? "(unknown)",
      email,
      phone: null,
      company: null,
      role: null,
      interest: "executed_ca",
      interestRaw: "NDA Signed",
      visitCount: null,
      leadScore: null,
      lastActivityAt: n.signed_at,
      firstSeenAt: n.signed_at,
      respondedAt: lastTouchedAt,
      lastTouchedAt,
      repliedAt: null,
      crossPropertyTouch: email ? crossPropByEmail.get(email) ?? null : null,
      signedNda: true,
      vaultVisits: 0,
      notes: null,
    });
  }

  const leads: PropertyLead[] = [
    ...Array.from(byEmail.values()),
    ...Array.from(byNameAndPhone.values()),
  ];

  // Sort: hot actions first, then by last activity desc
  const interestRank: Record<LeadInterestLevel, number> = {
    executed_ca: 5, offer_submitted: 4, info_request: 3,
    downloaded_om: 2, visited: 1, unknown: 0,
  };
  leads.sort((a, b) => {
    const ar = interestRank[a.interest] ?? 0;
    const br = interestRank[b.interest] ?? 0;
    if (ar !== br) return br - ar;
    const ad = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
    const bd = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
    return bd - ad;
  });

  return {
    activity,
    leads,
    totals: {
      leadCount: leads.length,
      withEmail: leads.filter((l) => !!l.email).length,
      withPhone: leads.filter((l) => !!l.phone).length,
      hotActions: leads.filter((l) => HOT_LEVELS.has(l.interest)).length,
      awaitingResponse: leads.filter(
        (l) => HOT_LEVELS.has(l.interest) && !l.respondedAt
      ).length,
    },
  };
}
