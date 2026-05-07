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
