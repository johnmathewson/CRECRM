/**
 * CRE OS — Communications data layer.
 *
 * Both Property and Contact workspaces render conversation threads. This
 * module is the single source for how communications get bundled into
 * threads + which signals each thread carries.
 *
 *   loadCommunicationsForProperty(propertyId) → ThreadSummary[]
 *   loadCommunicationsForContact(contactId)   → ThreadSummary[]
 *
 * Threading: communications are grouped by (subject normalized) ∪ (Gmail
 * thread id from raw_payload). One subject = one thread, regardless of
 * whether the email back-and-forth split contact_id over reply chains.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { castOne } from "./supabase-utils";
import { relativeTime } from "./time-utils";
import type {
  CommsFilters,
  CommsRow,
  CommsSummary,
  CommsSnapshot,
  PropertyCommsRollup,
} from "./communications-types";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export interface ThreadParticipant {
  id?: string;
  name: string;
  email: string | null;
}

export interface ThreadSummary {
  /** Stable thread key — gmail thread id when present, else subject hash */
  threadKey: string;
  subject: string;
  /** Most-recent message preview body */
  lastBodyPreview: string | null;
  /** Most-recent occurred_at (ISO) */
  lastOccurredAt: string | null;
  lastWhen: string;     // "3d ago"
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  participants: ThreadParticipant[];
  /** Channel of most recent message — email / sms / phone */
  channel: string | null;
  /** Has anything in this thread NOT been read yet */
  hasUnread: boolean;
  /** Property + contact links inferred from any message in the thread */
  propertyId: string | null;
  contactIds: string[];
}

// ── Public loaders ─────────────────────────────────────────────────────────
export async function loadCommunicationsForProperty(propertyId: string): Promise<ThreadSummary[]> {
  return loadByFilter({ property_id: propertyId });
}

export async function loadCommunicationsForContact(contactId: string): Promise<ThreadSummary[]> {
  return loadByFilter({ contact_id: contactId });
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard loader — flat, filterable view across ALL communications.
//
// Different shape from the thread loaders above: those bundle messages into
// conversations for a single property/contact workspace. This one answers
// "what have we sent, to whom, about which property" across the whole book,
// sliced by touch_kind (ai_followup / campaign / auto_ack / manual /
// internal). Powers /cre-os/communications.
// ═══════════════════════════════════════════════════════════════════════════

// Types + display constants live in communications-types.ts — a
// server-import-free module so client components can pull them without
// dragging next/headers into the browser bundle. Re-exported here for
// callers that already import from this file.
export type {
  TouchKind,
  CommsFilters,
  CommsRow,
  CommsSummary,
  PropertyCommsRollup,
  CommsSnapshot,
} from "./communications-types";
export { TOUCH_KIND_LABEL } from "./communications-types";

const DASHBOARD_ROW_LIMIT = 300;

export async function loadCommunicationsDashboard(
  filters: CommsFilters = {},
): Promise<CommsSnapshot> {
  const sb = createServerSupabase();
  const limit = filters.limit ?? DASHBOARD_ROW_LIMIT;

  // Shared predicate builder so the row query and the summary query can
  // never drift out of sync — a mismatch there would show counts that
  // don't match the visible list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    if (filters.propertyId) q = q.eq("property_id", filters.propertyId);
    if (filters.direction && filters.direction !== "all") {
      q = q.eq("direction", filters.direction);
    }
    if (filters.touchKind && filters.touchKind !== "all") {
      q = q.eq("touch_kind", filters.touchKind);
    }
    if (filters.since) q = q.gte("occurred_at", filters.since);
    if (filters.until) q = q.lte("occurred_at", `${filters.until}T23:59:59Z`);
    if (filters.q?.trim()) {
      const term = `%${filters.q.trim()}%`;
      q = q.or(
        `subject.ilike.${term},body_preview.ilike.${term},from_address.ilike.${term}`,
      );
    }
    return q;
  };

  // ── Rows (capped) ────────────────────────────────────────────────────
  const rowQuery = applyFilters(
    sb
      .from("communications")
      .select(
        `id, direction, touch_kind, subject, body_preview, from_address,
         to_addresses, occurred_at, lead_id,
         property:properties(id, name, slug),
         contact:contacts(id, full_name, email)`,
      )
      .eq("organization_id", ORG_ID)
      .order("occurred_at", { ascending: false }),
  );

  // Fetch one extra to detect truncation without a second count query
  const { data: rowData } = await rowQuery.limit(limit + 1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRows = (rowData ?? []) as any[];
  const truncated = rawRows.length > limit;
  const pageRows = truncated ? rawRows.slice(0, limit) : rawRows;

  const rows: CommsRow[] = pageRows.map((r) => {
    const property = castOne<{ id: string; name: string; slug: string }>(r.property);
    const contact = castOne<{ id: string; full_name: string; email: string | null }>(r.contact);
    return {
      id: r.id,
      direction: r.direction,
      touchKind: r.touch_kind ?? null,
      subject: r.subject ?? null,
      bodyPreview: r.body_preview ?? null,
      fromAddress: r.from_address ?? null,
      toAddresses: Array.isArray(r.to_addresses) ? r.to_addresses : [],
      occurredAt: r.occurred_at,
      occurredRelative: relativeTime(r.occurred_at),
      property: property
        ? { id: property.id, name: property.name, slug: property.slug }
        : null,
      contact: contact
        ? { id: contact.id, name: contact.full_name, email: contact.email }
        : null,
      leadId: r.lead_id ?? null,
    };
  });

  // ── Summary + per-property rollup over the FULL filtered set ─────────
  // Deliberately not limited: the KPI numbers describe everything matching
  // the filter, not just the visible page.
  const summaryQuery = applyFilters(
    sb
      .from("communications")
      .select("direction, touch_kind, occurred_at, property_id, to_addresses")
      .eq("organization_id", ORG_ID),
  );
  const { data: summaryData } = await summaryQuery;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (summaryData ?? []) as any[];

  const byKind: Record<string, number> = {};
  const recipients = new Set<string>();
  let inbound = 0;
  let outbound = 0;
  let replyEligible = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;

  const propAgg = new Map<
    string,
    { total: number; outbound: number; inbound: number; ai: number; camp: number; man: number; last: string | null }
  >();

  for (const r of all) {
    if (r.direction === "inbound") {
      inbound += 1;
    } else {
      outbound += 1;
      const kind = r.touch_kind ?? "unclassified";
      byKind[kind] = (byKind[kind] ?? 0) + 1;
      // internal = email to ourselves; auto_ack = courtesy receipt.
      // Neither is outreach that could earn a reply.
      if (kind !== "internal" && kind !== "auto_ack") replyEligible += 1;
      for (const addr of (Array.isArray(r.to_addresses) ? r.to_addresses : []) as string[]) {
        if (addr) recipients.add(addr.toLowerCase());
      }
    }

    if (!firstAt || r.occurred_at < firstAt) firstAt = r.occurred_at;
    if (!lastAt || r.occurred_at > lastAt) lastAt = r.occurred_at;

    if (r.property_id) {
      const cur =
        propAgg.get(r.property_id) ??
        { total: 0, outbound: 0, inbound: 0, ai: 0, camp: 0, man: 0, last: null as string | null };
      cur.total += 1;
      if (r.direction === "inbound") cur.inbound += 1;
      else {
        cur.outbound += 1;
        if (r.touch_kind === "ai_followup") cur.ai += 1;
        else if (r.touch_kind === "campaign") cur.camp += 1;
        else if (r.touch_kind === "manual") cur.man += 1;
      }
      if (!cur.last || r.occurred_at > cur.last) cur.last = r.occurred_at;
      propAgg.set(r.property_id, cur);
    }
  }

  const summary: CommsSummary = {
    total: all.length,
    inbound,
    outbound,
    byKind,
    distinctRecipients: recipients.size,
    replyRatePct: replyEligible > 0 ? Math.round((inbound / replyEligible) * 100) : null,
    firstAt,
    lastAt,
  };

  // Hydrate property names in one lookup rather than per-row joins
  const propIds = Array.from(propAgg.keys());
  const propMeta = new Map<string, { name: string; slug: string }>();
  if (propIds.length > 0) {
    const { data: props } = await sb
      .from("properties")
      .select("id, name, slug")
      .in("id", propIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of ((props ?? []) as any[])) {
      propMeta.set(p.id, { name: p.name, slug: p.slug });
    }
  }

  const byProperty: PropertyCommsRollup[] = Array.from(propAgg.entries())
    .map(([pid, agg]) => {
      const meta = propMeta.get(pid);
      return {
        propertyId: pid,
        propertyName: meta?.name ?? "(unknown property)",
        propertySlug: meta?.slug ?? "",
        total: agg.total,
        outbound: agg.outbound,
        inbound: agg.inbound,
        aiFollowup: agg.ai,
        campaign: agg.camp,
        manual: agg.man,
        lastTouchAt: agg.last,
        lastTouchRelative: relativeTime(agg.last),
      };
    })
    .sort((a, b) => b.total - a.total);

  // ── Property dropdown — every property with ANY comms, unfiltered so
  //    the user can always switch to a different one ────────────────────
  const { data: optionRows } = await sb
    .from("communications")
    .select("property:properties(id, name)")
    .eq("organization_id", ORG_ID)
    .not("property_id", "is", null);

  const optionMap = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of ((optionRows ?? []) as any[])) {
    const p = castOne<{ id: string; name: string }>(r.property);
    if (p?.id && !optionMap.has(p.id)) optionMap.set(p.id, p.name);
  }
  const propertyOptions = Array.from(optionMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows, summary, byProperty, propertyOptions, truncated };
}

// ── Internals ──────────────────────────────────────────────────────────────
async function loadByFilter(filter: { property_id?: string; contact_id?: string }): Promise<ThreadSummary[]> {
  const sb = createServerSupabase();

  let q = sb
    .from("communications")
    .select(
      "id, channel, direction, external_id, subject, body_preview, from_address, to_addresses, occurred_at, is_read, contact_id, property_id, raw_payload, contact:contacts(id, full_name, email)",
    )
    .eq("organization_id", ORG_ID)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (filter.property_id) q = q.eq("property_id", filter.property_id);
  if (filter.contact_id) q = q.eq("contact_id", filter.contact_id);

  const { data: rows } = await q;
  return groupIntoThreads((rows ?? []) as any[]);
}

function groupIntoThreads(rows: any[]): ThreadSummary[] {
  // Bucket by (gmail thread id) → fall back to (normalized subject)
  const buckets = new Map<string, any[]>();
  for (const r of rows) {
    const threadKey = extractThreadKey(r);
    if (!buckets.has(threadKey)) buckets.set(threadKey, []);
    buckets.get(threadKey)!.push(r);
  }

  const threads: ThreadSummary[] = [];
  Array.from(buckets.entries()).forEach(([threadKey, msgs]) => {
    msgs.sort((a: any, b: any) => new Date(b.occurred_at ?? 0).getTime() - new Date(a.occurred_at ?? 0).getTime());
    const last = msgs[0];
    const inboundCount = msgs.filter((m: any) => m.direction === "inbound").length;
    const outboundCount = msgs.filter((m: any) => m.direction === "outbound").length;
    const participants = collectParticipants(msgs);
    const contactIds: string[] = Array.from(new Set(
      msgs.map((m: any) => m.contact_id).filter((v: any): v is string => !!v),
    ));
    const propertyId: string | null = msgs.find((m: any) => m.property_id)?.property_id ?? null;

    threads.push({
      threadKey,
      subject: cleanSubject(last.subject) || "(no subject)",
      lastBodyPreview: last.body_preview ?? null,
      lastOccurredAt: last.occurred_at ?? null,
      lastWhen: relativeTime(last.occurred_at),
      messageCount: msgs.length,
      inboundCount,
      outboundCount,
      participants,
      channel: last.channel ?? null,
      hasUnread: msgs.some((m: any) => m.direction === "inbound" && !m.is_read),
      propertyId,
      contactIds,
    });
  });

  // Newest threads first
  threads.sort((a, b) =>
    new Date(b.lastOccurredAt ?? 0).getTime() - new Date(a.lastOccurredAt ?? 0).getTime(),
  );
  return threads;
}

/** Pull a stable thread key from the row. Prefers Gmail thread id from raw_payload. */
function extractThreadKey(r: any): string {
  // Gmail-style: raw_payload?.threadId, raw_payload?.thread_id, or direct field
  const payload = r.raw_payload ?? null;
  if (payload?.threadId) return `gmail:${payload.threadId}`;
  if (payload?.thread_id) return `gmail:${payload.thread_id}`;
  if (payload?.thread) return `gmail:${payload.thread}`;
  if (r.external_id) return `ext:${r.external_id}`;
  // Fall back to subject — strip Re:/Fwd: noise so reply chains land in one bucket
  const norm = cleanSubject(r.subject);
  return `subj:${norm.toLowerCase()}`;
}

function cleanSubject(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/^\s*(re|fwd?|aw|sv|tr)\s*:\s*/gi, "")
    .replace(/^\s*(re|fwd?)\s*:\s*/gi, "") // double-prefix like "Re: Re:"
    .trim();
}

function collectParticipants(msgs: any[]): ThreadParticipant[] {
  const byEmail = new Map<string, ThreadParticipant>();

  for (const m of msgs) {
    // The named contact (preferred — has a full name we can show)
    const c = castOne<{ id: string; full_name: string; email: string }>(m.contact);
    if (c?.id) {
      const key = (c.email ?? c.id).toLowerCase();
      if (!byEmail.has(key)) {
        byEmail.set(key, { id: c.id, name: c.full_name ?? c.email ?? "Unknown", email: c.email });
      }
    }
    // From / to addresses — if we don't have a contact match, surface the raw email
    const from = (m.from_address ?? "").toLowerCase().trim();
    if (from && !byEmail.has(from)) {
      byEmail.set(from, { name: from, email: from });
    }
    const tos: string[] = Array.isArray(m.to_addresses) ? m.to_addresses : [];
    for (const t of tos) {
      const k = (t ?? "").toLowerCase().trim();
      if (k && !byEmail.has(k)) {
        byEmail.set(k, { name: k, email: k });
      }
    }
  }

  // Drop our own outbound address from the visible participant list (we know it's us)
  const SELF_HINT = "stewardshipcre.com";
  const list = Array.from(byEmail.values()).filter(
    (p) => !p.email || !p.email.toLowerCase().endsWith(SELF_HINT),
  );
  return list.slice(0, 6);
}
