/**
 * Prospector Inbox — unified view of every cadence touch (outbound) and
 * its replies (inbound). The agent's stream-of-consciousness.
 *
 * Data sources:
 *   lane_touches  — every outbound touch (sent / queued / drafted / responded)
 *   communications — inbound replies, threaded by gmail_thread_id
 *
 * The poll-gmail cron matches inbound replies to the sent lane_touch via
 * the Gmail thread_id stored in lane_touches.metadata, then writes a
 * companion lane_touches row with channel='email' status='responded' and
 * direction recorded via metadata.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────

export type TouchDirection = "outbound" | "inbound";
export type TouchChannel = "email" | "sms" | "call" | "letter" | "voicemail";
export type TouchStatus =
  | "queued"
  | "drafted"
  | "approved"
  | "sent"
  | "failed"
  | "skipped"
  | "responded";

export interface InboxTouch {
  id: string;
  direction: TouchDirection;
  channel: TouchChannel;
  status: TouchStatus;

  // Subject / body for display
  subject: string | null;
  bodyPreview: string | null;
  /** Full body — populated by loadTouchDetail() */
  bodyFull?: string | null;

  // Who & where
  propertyId: string;
  propertySlug: string | null;
  propertyName: string;
  propertyAddress: string | null;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;

  // Which lane
  laneId: string | null;
  laneName: string | null;

  // Timestamps
  scheduledAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;

  // Gmail threading (so we can group reply chains)
  gmailThreadId: string | null;
  /** If this is a reply, the original outbound touch it replied to */
  parentTouchId: string | null;

  // ── Reply intelligence (populated only on inbound replies) ──────────
  /** AI-classified intent of the reply */
  classification?: {
    intent: "interested" | "question" | "declined" | "hostile" | "unsubscribe" | "out_of_office" | "unclear";
    confidence: number;
    summary: string;
    suggestedReply: string;
    nextAction?: string;
  } | null;
}

export interface InboxSnapshot {
  totals: {
    sentToday: number;
    sent7d: number;
    awaitingReply: number;
    repliesUnread: number;
    drafted: number;
  };
  touches: InboxTouch[];
}

export interface InboxFilters {
  /** Status filter — 'sent' | 'drafted' | 'replied' | 'failed' | 'all' (default) */
  status?: "all" | "sent" | "drafted" | "replied" | "failed";
  /** Limit to a single lane */
  laneId?: string;
  /** Limit to a channel */
  channel?: TouchChannel;
  /** Search across subject + body + property name + contact name */
  q?: string;
  limit?: number;
  offset?: number;
}

// ── Loaders ────────────────────────────────────────────────────────────────

export async function loadProspectorInbox(
  filters: InboxFilters = {}
): Promise<InboxSnapshot> {
  const sb = createServerSupabase();
  const limit = Math.min(filters.limit ?? 100, 250);
  const offset = filters.offset ?? 0;

  const now = Date.now();
  const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 3600 * 1000).toISOString();

  // Aggregate counts (parallel)
  const [sentTodayRes, sent7dRes, awaitingReplyRes, repliesRes, draftedRes] = await Promise.all([
    sb.from("lane_touches").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "sent")
      .gte("sent_at", dayAgo),
    sb.from("lane_touches").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "sent")
      .gte("sent_at", weekAgo),
    sb.from("lane_touches").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "sent")
      .is("responded_at", null),
    sb.from("lane_touches").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "responded"),
    sb.from("lane_touches").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).in("status", ["drafted", "approved", "queued"]),
  ]);

  // Build base query
  let q = sb.from("lane_touches").select(`
    id, organization_id, enrollment_id, lane_id, property_id, contact_id,
    step_index, channel, status, scheduled_at, sent_at, responded_at,
    subject, body, metadata, created_at,
    property:properties(id, slug, name, address),
    contact:contacts(id, full_name, email),
    lane:lanes(id, name)
  `, { count: "exact" })
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.status === "sent") q = q.eq("status", "sent");
  else if (filters.status === "drafted") q = q.in("status", ["drafted", "approved", "queued"]);
  else if (filters.status === "replied") q = q.eq("status", "responded");
  else if (filters.status === "failed") q = q.eq("status", "failed");

  if (filters.laneId) q = q.eq("lane_id", filters.laneId);
  if (filters.channel) q = q.eq("channel", filters.channel);
  if (filters.q) {
    q = q.or(`subject.ilike.%${filters.q}%,body.ilike.%${filters.q}%`);
  }

  const { data } = await q;
  type Row = Record<string, unknown>;
  const rows = (data ?? []) as Row[];

  const touches: InboxTouch[] = rows.map((r) => {
    const property = pickOne<{ id: string; slug: string | null; name: string | null; address: string | null }>(r.property);
    const contact = pickOne<{ id: string; full_name: string | null; email: string | null }>(r.contact);
    const lane = pickOne<{ id: string; name: string }>(r.lane);
    const metadata = (r.metadata as Record<string, unknown>) ?? {};

    const direction: TouchDirection = (r.status as string) === "responded" ? "inbound" : "outbound";

    return {
      id: r.id as string,
      direction,
      channel: r.channel as TouchChannel,
      status: r.status as TouchStatus,
      subject: (r.subject as string) ?? null,
      bodyPreview: typeof r.body === "string" ? (r.body as string).slice(0, 200) : null,
      propertyId: r.property_id as string,
      propertySlug: property?.slug ?? null,
      propertyName: property?.name ?? "(unnamed property)",
      propertyAddress: property?.address ?? null,
      contactId: (r.contact_id as string) ?? null,
      contactName: contact?.full_name ?? null,
      contactEmail: contact?.email ?? null,
      laneId: (r.lane_id as string) ?? null,
      laneName: lane?.name ?? null,
      scheduledAt: (r.scheduled_at as string) ?? null,
      sentAt: (r.sent_at as string) ?? null,
      respondedAt: (r.responded_at as string) ?? null,
      createdAt: r.created_at as string,
      gmailThreadId: (metadata.gmail_thread_id as string) ?? null,
      parentTouchId: (metadata.parent_touch_id as string) ?? null,
      classification: (metadata.classification as InboxTouch["classification"]) ?? null,
    };
  });

  return {
    totals: {
      sentToday: sentTodayRes.count ?? 0,
      sent7d: sent7dRes.count ?? 0,
      awaitingReply: awaitingReplyRes.count ?? 0,
      repliesUnread: repliesRes.count ?? 0,
      drafted: draftedRes.count ?? 0,
    },
    touches,
  };
}

export async function loadTouchDetail(id: string): Promise<InboxTouch | null> {
  const sb = createServerSupabase();
  const { data } = await sb.from("lane_touches").select(`
    id, organization_id, enrollment_id, lane_id, property_id, contact_id,
    step_index, channel, status, scheduled_at, sent_at, responded_at,
    subject, body, metadata, created_at,
    property:properties(id, slug, name, address),
    contact:contacts(id, full_name, email),
    lane:lanes(id, name)
  `)
    .eq("organization_id", ORG_ID)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const property = pickOne<{ id: string; slug: string | null; name: string | null; address: string | null }>(data.property);
  const contact = pickOne<{ id: string; full_name: string | null; email: string | null }>(data.contact);
  const lane = pickOne<{ id: string; name: string }>(data.lane);
  const metadata = (data.metadata as Record<string, unknown>) ?? {};

  const direction: TouchDirection = (data.status as string) === "responded" ? "inbound" : "outbound";

  return {
    id: data.id as string,
    direction,
    channel: data.channel as TouchChannel,
    status: data.status as TouchStatus,
    subject: (data.subject as string) ?? null,
    bodyPreview: typeof data.body === "string" ? (data.body as string).slice(0, 200) : null,
    bodyFull: (data.body as string) ?? null,
    propertyId: data.property_id as string,
    propertySlug: property?.slug ?? null,
    propertyName: property?.name ?? "(unnamed property)",
    propertyAddress: property?.address ?? null,
    contactId: (data.contact_id as string) ?? null,
    contactName: contact?.full_name ?? null,
    contactEmail: contact?.email ?? null,
    laneId: (data.lane_id as string) ?? null,
    laneName: lane?.name ?? null,
    scheduledAt: (data.scheduled_at as string) ?? null,
    sentAt: (data.sent_at as string) ?? null,
    respondedAt: (data.responded_at as string) ?? null,
    createdAt: data.created_at as string,
    gmailThreadId: (metadata.gmail_thread_id as string) ?? null,
    parentTouchId: (metadata.parent_touch_id as string) ?? null,
    classification: (metadata.classification as InboxTouch["classification"]) ?? null,
  };
}

function pickOne<T>(v: unknown): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return v as T;
}
