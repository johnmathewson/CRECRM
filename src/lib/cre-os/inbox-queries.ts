/**
 * CRE OS — Inbox / Lead Command data layer.
 *
 *   loadInboxList(filters) → cards for /cre-os/inbox
 *   loadLeadDetail(id)     → full lead detail + thread
 *
 * Wraps the existing leads + communications + lead_events tables.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { castOne } from "./supabase-utils";
import { relativeTime, daysSince } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export type LeadUrgency = "hot" | "warm" | "cold";
export type LeadIntent = "buy" | "lease" | "sell" | "info" | "other" | string;

/** Operational state for filtering the inbox. */
export type LeadBucket = "all" | "needs-response" | "drafted" | "hot" | "today" | "archived" | "spam";

export interface LeadCard {
  id: string;
  /** Sender name or email or "Unknown" — never null */
  senderDisplay: string;
  senderEmail: string | null;
  senderPhone: string | null;

  /** Property the lead refers to, if matched */
  property: { id: string; name: string; slug: string } | null;
  propertyLabel: string | null;

  /** Channel — email / sms / phone / web */
  source: string | null;

  status: string | null;
  intent: LeadIntent | null;
  urgency: LeadUrgency | null;

  /** AI-extracted summary line ("1031 buyer, $4M, 60-day") */
  qualifierSummary: string | null;
  /** Original subject line */
  rawSubject: string | null;
  /** First line / preview of body */
  bodyPreview: string | null;

  hasDraft: boolean;
  ackSent: boolean;
  finalSent: boolean;
  promotedToDeal: boolean;

  createdAt: string | null;
  /** "12m ago" / "3h ago" — for the card */
  createdRelative: string;
  /** Hours since arrival — drives the SLA overdue chip */
  hoursSinceArrival: number;
  /** Past the 60-min substantive-reply SLA? */
  slaOverdue: boolean;
}

export interface LeadDetail {
  id: string;
  // Sender
  senderDisplay: string;
  senderName: string | null;
  senderEmail: string | null;
  senderPhone: string | null;
  // Linked records
  property: { id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null } | null;
  propertyLabel: string | null;
  contact: { id: string; fullName: string; warmth: string | null } | null;
  // Lead state
  source: string | null;
  status: string | null;
  intent: LeadIntent | null;
  urgency: LeadUrgency | null;
  qualifierSummary: string | null;
  // Original message
  rawSubject: string | null;
  rawBody: string | null;
  // AI extraction (full JSON for the geek-out drawer)
  claudeExtraction: any;
  // Reply state
  draftReply: string | null;
  draftAttachments: any;
  finalReply: string | null;
  finalSentAt: string | null;
  ackSentAt: string | null;
  linkedDealId: string | null;
  // Meta
  createdAt: string | null;
  createdRelative: string;
  hoursSinceArrival: number;
  slaOverdue: boolean;
  // Thread
  thread: Array<{
    id: string;
    direction: "inbound" | "outbound" | string | null;
    subject: string | null;
    bodyPreview: string | null;
    fromAddress: string | null;
    occurredAt: string | null;
    when: string;
    channel: string | null;
  }>;
  // Lead events log (state transitions, etc.)
  events: Array<{
    id: string;
    occurredAt: string | null;
    when: string;
    eventType: string | null;
    notes: string | null;
  }>;
  notes: string | null;
}

// ── List loader ───────────────────────────────────────────────────────────
export async function loadInboxList(): Promise<LeadCard[]> {
  const sb = createServerSupabase();

  const { data: rows } = await sb
    .from("leads")
    .select(
      `id, source, status, intent, urgency, sender_name, sender_email, sender_phone,
       property_label, qualifier_summary, raw_subject, raw_body,
       draft_reply, auto_ack_sent_at, final_sent_at, linked_deal_id, created_at,
       property:properties(id, name, slug)`,
    )
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false })
    .limit(200);

  return ((rows ?? []) as any[]).map((r): LeadCard => {
    const property = castOne<{ id: string; name: string; slug: string }>(r.property);
    const senderDisplay = r.sender_name?.trim() || r.sender_email || r.sender_phone || "Unknown";
    const hours = r.created_at
      ? Math.max(0, (Date.now() - new Date(r.created_at).getTime()) / 3_600_000)
      : 0;
    const status = (r.status ?? "").toLowerCase();
    const slaOverdue =
      status === "new" && hours > 1 && !r.final_sent_at;

    return {
      id: r.id,
      senderDisplay,
      senderEmail: r.sender_email ?? null,
      senderPhone: r.sender_phone ?? null,
      property,
      propertyLabel: r.property_label ?? null,
      source: r.source ?? null,
      status: r.status ?? null,
      intent: r.intent ?? null,
      urgency: r.urgency ?? null,
      qualifierSummary: r.qualifier_summary ?? null,
      rawSubject: r.raw_subject ?? null,
      bodyPreview: previewBody(r.raw_body),
      hasDraft: !!r.draft_reply,
      ackSent: !!r.auto_ack_sent_at,
      finalSent: !!r.final_sent_at,
      promotedToDeal: !!r.linked_deal_id,
      createdAt: r.created_at,
      createdRelative: relativeTime(r.created_at),
      hoursSinceArrival: hours,
      slaOverdue,
    };
  });
}

// ── Detail loader ─────────────────────────────────────────────────────────
export async function loadLeadDetail(id: string): Promise<LeadDetail | null> {
  const sb = createServerSupabase();

  const { data: lRaw } = await sb
    .from("leads")
    .select(
      `*,
       property:properties(id, name, slug, address, city, state),
       contact:contacts(id, full_name, warmth)`,
    )
    .eq("organization_id", ORG_ID)
    .eq("id", id)
    .maybeSingle();
  const l: any = lRaw;
  if (!l) return null;

  const [{ data: events }, { data: thread }] = await Promise.all([
    sb.from("lead_events")
      .select("id, event_type, notes, occurred_at")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: true }),
    sb.from("communications")
      .select("id, direction, subject, body_preview, from_address, occurred_at, channel")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: true }),
  ]);

  const property = castOne<{ id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null }>(l.property);
  const contact = castOne<{ id: string; full_name: string; warmth: string | null }>(l.contact);
  const senderName = l.sender_name ?? null;
  const senderEmail = l.sender_email ?? null;
  const senderPhone = l.sender_phone ?? null;
  const senderDisplay = senderName?.trim() || senderEmail || senderPhone || "Unknown";

  const hours = l.created_at
    ? Math.max(0, (Date.now() - new Date(l.created_at).getTime()) / 3_600_000)
    : 0;
  const status = (l.status ?? "").toLowerCase();
  const slaOverdue = status === "new" && hours > 1 && !l.final_sent_at;

  return {
    id: l.id,
    senderDisplay,
    senderName,
    senderEmail,
    senderPhone,
    property,
    propertyLabel: l.property_label ?? null,
    contact: contact ? { id: contact.id, fullName: contact.full_name, warmth: contact.warmth } : null,
    source: l.source,
    status: l.status,
    intent: l.intent,
    urgency: l.urgency,
    qualifierSummary: l.qualifier_summary,
    rawSubject: l.raw_subject,
    rawBody: l.raw_body,
    claudeExtraction: l.claude_extraction,
    draftReply: l.draft_reply,
    draftAttachments: l.draft_attachments,
    finalReply: l.final_reply,
    finalSentAt: l.final_sent_at,
    ackSentAt: l.auto_ack_sent_at,
    linkedDealId: l.linked_deal_id,
    createdAt: l.created_at,
    createdRelative: relativeTime(l.created_at),
    hoursSinceArrival: hours,
    slaOverdue,
    thread: ((thread ?? []) as any[]).map((m) => ({
      id: m.id,
      direction: m.direction,
      subject: m.subject,
      bodyPreview: m.body_preview,
      fromAddress: m.from_address,
      occurredAt: m.occurred_at,
      when: relativeTime(m.occurred_at),
      channel: m.channel,
    })),
    events: ((events ?? []) as any[]).map((e) => ({
      id: e.id,
      occurredAt: e.occurred_at,
      when: relativeTime(e.occurred_at),
      eventType: e.event_type,
      notes: e.notes,
    })),
    notes: l.notes,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function previewBody(body: string | null | undefined): string | null {
  if (!body) return null;
  // Strip HTML tags + excess whitespace; clip to ~160 chars
  const stripped = body
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return null;
  return stripped.length > 160 ? stripped.slice(0, 160) + "…" : stripped;
}

// Bucket assignment lives in inbox-bucket.ts (client-safe — no Supabase deps).
