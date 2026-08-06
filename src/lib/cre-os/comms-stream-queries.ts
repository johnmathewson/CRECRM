/**
 * comms-stream-queries — data layer for the Communications stream
 * (north-star surface: one chronological stream of every touch).
 *
 * READ-ONLY BY DESIGN. This module only SELECTs from `communications`
 * (joined to contacts/properties/leads). It performs no writes, no
 * migrations, no mutations of historical data — the stream is a lens over
 * the permanent log, never an editor of it.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { relativeTime } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export type StreamChannel = "email" | "sms" | "phone" | "website" | string;

export interface StreamRow {
  id: string;
  channel: StreamChannel;
  direction: "inbound" | "outbound" | string;
  /** Human party display: contact name, else raw address/phone */
  who: string;
  /** True when this was sent by an automated path (ai_followup, auto_ack, internal) */
  automated: boolean;
  touchKind: string | null;
  subject: string | null;
  preview: string | null;
  property: { id: string; name: string } | null;
  leadId: string | null;
  contactId: string | null;
  occurredAt: string;
  when: string;
  dayKey: string;
  /** is_read=true — user cleared it from the stream (reversible, never deleted) */
  cleared: boolean;
  /** Latest inbound with no later outbound to same party → needs John */
  unanswered: boolean;
}

export interface StreamData {
  rows: StreamRow[];
  unansweredCount: number;
  properties: Array<{ id: string; name: string }>;
}

const AUTOMATED_KINDS = new Set(["ai_followup", "auto_ack", "internal", "campaign"]);

/** Engagement signals (CREXi page views, CA executions…) are robot events,
 *  not messages — they must never mark a party Unanswered or pose as a
 *  human touch. Matched by source AND subject prefix: a 7/29 backfill once
 *  wrote them under a different source and polluted the Unanswered count
 *  with 81 phantom parties. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSignal(r: any): boolean {
  return (
    String(r.raw_payload?.source ?? "") === "crexi_report" ||
    String(r.subject ?? "").startsWith("CREXi activity")
  );
}

// (Party identity is computed inside loadCommsStream via keyOf — contact id
// when resolvable through the address→contact map, else normalized address.
// Keep ONE keying implementation; a second one drifting is how the queue
// lost people in Aug 2026.)

export async function loadCommsStream(limit = 400): Promise<StreamData> {
  const sb = createServerSupabase();

  const SELECT = `id, channel, direction, subject, body_preview, from_address, to_addresses,
       occurred_at, touch_kind, raw_payload, lead_id, contact_id, is_read,
       contact:contacts(id, full_name),
       property:properties(id, name)`;

  // FULL history, not a window. The answered/unanswered state must consider
  // every touch ever — with a 400-row window, a CA-signer from June simply
  // fell off the radar (Aug 2026: three-month-old unanswered inquiries were
  // invisible while the badge showed 0). 5000 is a safety cap, not a window;
  // revisit with a SQL-side computation long before the log approaches it.
  const { data: rowsRaw } = await sb
    .from("communications")
    .select(SELECT)
    .eq("organization_id", ORG_ID)
    .order("occurred_at", { ascending: false })
    .limit(5000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (rowsRaw ?? []) as any[];

  // ── Identity unification ────────────────────────────────────────────────
  // A reply often gets logged under the contact while the inbound sits under
  // the bare email; keyed separately, the person looks eternally unanswered.
  // Map every address we've ever seen alongside a contact_id to that contact,
  // then key rows by contact when resolvable.
  const addrOf = (r: {
    direction: string;
    from_address: string | null;
    to_addresses: string[] | null;
  }): string | null => {
    const rawAddr =
      r.direction === "inbound" ? r.from_address : (r.to_addresses ?? [])[0];
    if (!rawAddr) return null;
    const s = String(rawAddr).trim().toLowerCase();
    const digits = s.replace(/\D/g, "");
    return digits.length >= 10 ? `p:${digits.slice(-10)}` : `e:${s}`;
  };
  const addrToContact = new Map<string, string>();
  for (const r of all) {
    const a = addrOf(r);
    if (a && r.contact_id && !addrToContact.has(a)) addrToContact.set(a, r.contact_id);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyOf = (r: any): string => {
    const a = addrOf(r);
    const cid = r.contact_id ?? (a ? addrToContact.get(a) : null);
    return cid ? `c:${cid}` : a ?? "unknown";
  };

  // ── Answered/unanswered ─────────────────────────────────────────────────
  // Newest-first walk over rows that can actually ask or answer:
  //   - inbound counts only if it's a real message (not a CREXi signal)
  //   - outbound counts only if a HUMAN could call it a reply: manual,
  //     AI follow-up, campaign, or untagged. An auto-ack is a receipt, not
  //     an answer — it must never remove someone from the queue.
  const NON_ANSWERING_OUTBOUND = new Set(["auto_ack", "internal"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isRelevant = (r: any): boolean =>
    r.direction === "inbound"
      ? !isSignal(r)
      : !NON_ANSWERING_OUTBOUND.has(r.touch_kind ?? "");

  const latestSeen = new Map<string, { direction: string; automated: boolean; answeredCall: boolean; cleared: boolean }>();
  for (const r of all) {
    if (!isRelevant(r)) continue;
    const key = keyOf(r);
    if (key === "unknown") continue;
    if (!latestSeen.has(key)) {
      latestSeen.set(key, {
        direction: r.direction,
        automated: AUTOMATED_KINDS.has(r.touch_kind ?? "") || isSignal(r),
        // An answered phone call is inbound in the log but already handled
        // — John took the call live. Must not resurface as Unanswered.
        answeredCall: r.channel === "phone" && r.raw_payload?.status === "answered",
        // Cleared = explicit triage; the queue hides the conversation, so
        // the badge must not count it either. (The badge/queue disagreed
        // in Aug 2026: "Unanswered · 15" over an empty queue.)
        cleared: !!r.is_read,
      });
    }
  }

  // ── Display rows ────────────────────────────────────────────────────────
  // Latest `limit` rows for the browsing stream, PLUS the latest relevant
  // row of every unanswered party older than the window — the queue must
  // always be able to render everyone the badge counts.
  const display = all.slice(0, limit);
  const displayIds = new Set(display.map((r) => r.id));
  const coveredParties = new Set(display.map((r) => keyOf(r)));
  for (const r of all.slice(limit)) {
    const key = keyOf(r);
    if (key === "unknown" || coveredParties.has(key)) continue;
    const latest = latestSeen.get(key);
    if (
      latest &&
      latest.direction === "inbound" &&
      !latest.automated &&
      !latest.answeredCall &&
      !latest.cleared &&
      isRelevant(r)
    ) {
      display.push(r);
      displayIds.add(r.id);
      coveredParties.add(key);
    }
  }
  const raw = display;

  const propSet = new Map<string, string>();
  const rows: StreamRow[] = raw.map((r) => {
    const contact = Array.isArray(r.contact) ? r.contact[0] : r.contact;
    const property = Array.isArray(r.property) ? r.property[0] : r.property;
    if (property?.id) propSet.set(property.id, property.name);
    const key = keyOf(r);
    const latest = latestSeen.get(key);
    const automated = AUTOMATED_KINDS.has(r.touch_kind ?? "") || isSignal(r);
    const counterparty =
      r.direction === "inbound" ? r.from_address : (r.to_addresses ?? [])[0];
    const d = new Date(r.occurred_at);
    return {
      id: r.id,
      channel: r.channel,
      direction: r.direction,
      who: contact?.full_name ?? counterparty ?? "Unknown",
      automated,
      touchKind: r.touch_kind ?? null,
      subject: r.subject ?? null,
      preview: r.body_preview ? String(r.body_preview).slice(0, 180) : null,
      property: property ? { id: property.id, name: property.name } : null,
      leadId: r.lead_id ?? null,
      contactId: contact?.id ?? r.contact_id ?? null,
      occurredAt: r.occurred_at,
      cleared: !!r.is_read,
      when: relativeTime(r.occurred_at),
      dayKey: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      unanswered:
        r.direction === "inbound" &&
        latest?.direction === "inbound" &&
        !latest.automated &&
        !latest.answeredCall,
    };
  });

  // Count over FULL history with the unified keys — a party is unanswered
  // when their latest relevant touch is a real inbound message that isn't
  // an answered call and hasn't been explicitly cleared.
  const unansweredParties = new Set<string>();
  for (const [key, latest] of Array.from(latestSeen.entries())) {
    if (
      latest.direction === "inbound" &&
      !latest.automated &&
      !latest.answeredCall &&
      !latest.cleared
    ) {
      unansweredParties.add(key);
    }
  }

  return {
    rows,
    unansweredCount: unansweredParties.size,
    properties: Array.from(propSet, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  };
}
