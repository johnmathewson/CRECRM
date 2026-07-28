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
  /** Latest inbound with no later outbound to same party → needs John */
  unanswered: boolean;
}

export interface StreamData {
  rows: StreamRow[];
  unansweredCount: number;
  properties: Array<{ id: string; name: string }>;
}

const AUTOMATED_KINDS = new Set(["ai_followup", "auto_ack", "internal", "campaign"]);

/** Identity key for answered/unanswered pairing: contact if linked, else
 *  normalized counterparty address (email lowercased / phone digits). */
function partyKey(r: {
  contact_id: string | null;
  direction: string;
  from_address: string | null;
  to_addresses: string[] | null;
}): string {
  if (r.contact_id) return `c:${r.contact_id}`;
  const raw = r.direction === "inbound" ? r.from_address : (r.to_addresses ?? [])[0];
  if (!raw) return "unknown";
  const s = String(raw).trim().toLowerCase();
  const digits = s.replace(/\D/g, "");
  return digits.length >= 10 ? `p:${digits.slice(-10)}` : `e:${s}`;
}

export async function loadCommsStream(limit = 400): Promise<StreamData> {
  const sb = createServerSupabase();

  const { data: rowsRaw } = await sb
    .from("communications")
    .select(
      `id, channel, direction, subject, body_preview, from_address, to_addresses,
       occurred_at, touch_kind, raw_payload, lead_id, contact_id,
       contact:contacts(id, full_name),
       property:properties(id, name)`
    )
    .eq("organization_id", ORG_ID)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (rowsRaw ?? []) as any[];

  // Answered/unanswered: newest-first walk; a party's latest row decides.
  const latestSeen = new Map<string, { direction: string; automated: boolean }>();
  for (const r of raw) {
    const key = partyKey(r);
    if (!latestSeen.has(key)) {
      const src = String(r.raw_payload?.source ?? "");
      latestSeen.set(key, {
        direction: r.direction,
        automated: AUTOMATED_KINDS.has(r.touch_kind ?? "") || src === "crexi_report",
      });
    }
  }

  const propSet = new Map<string, string>();
  const rows: StreamRow[] = raw.map((r) => {
    const contact = Array.isArray(r.contact) ? r.contact[0] : r.contact;
    const property = Array.isArray(r.property) ? r.property[0] : r.property;
    if (property?.id) propSet.set(property.id, property.name);
    const key = partyKey(r);
    const latest = latestSeen.get(key);
    const automated = AUTOMATED_KINDS.has(r.touch_kind ?? "");
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
      when: relativeTime(r.occurred_at),
      dayKey: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      unanswered:
        r.direction === "inbound" &&
        latest?.direction === "inbound" &&
        !latest.automated,
    };
  });

  const unansweredParties = new Set(
    rows.filter((r) => r.unanswered).map((r) => (r.contactId ? `c:${r.contactId}` : r.who))
  );

  return {
    rows,
    unansweredCount: unansweredParties.size,
    properties: Array.from(propSet, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  };
}
