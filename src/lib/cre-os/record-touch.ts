/**
 * ONE way in for people and messages.
 *
 *   resolveParty()  — who is this? Returns a contact_id, creating the contact
 *                     when the person is genuinely new. Email is identity.
 *                     Phone + matching name is identity. Phone alone is
 *                     identity ONLY for an anonymous caller/texter (no email,
 *                     no name) — and even then never across people who share
 *                     an office line without a name to break the tie.
 *   recordTouch()   — write a communications row. Every row has a person
 *                     (contact_id) unless it is system-internal, every row
 *                     has an external_id (synthesized when the channel gives
 *                     none), and a failed insert THROWS instead of logging.
 *
 * Why this exists (Oct 2026 integrity audit): 15 write paths each resolved
 * identity their own way and inserted unchecked. Messages were filed under
 * the wrong person, phones were stored five formats, replies vanished when
 * no lead matched, and nothing could be enforced at the DB because every
 * writer assumed nulls were fine. Migration 0035 now rejects those rows.
 * Any new writer MUST go through these two functions — do not hand-roll an
 * insert into communications or contacts.
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toE164 } from "@/lib/twilio";
import { nameSimilar } from "./find-or-create-contact";

export const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any, any, any>;

const E164 = /^\+[1-9]\d{9,14}$/;

/** Lowercase, trimmed, must look like an address. Anything else → null. */
export function normalizeEmail(e: string | null | undefined): string | null {
  if (!e) return null;
  const s = String(e).trim().toLowerCase();
  return s.includes("@") && !/\s/.test(s) ? s : null;
}

/** Strict E.164 or null. A phone that can't be normalized is not stored —
 *  "610.416.1341" vs "+16104161341" is how one person became three. */
export function normalizePhone(p: string | null | undefined): string | null {
  const e = toE164(p ?? null);
  return e && E164.test(e) ? e : null;
}

/** Placeholder names earlier writers used when they had nothing better. A
 *  contact wearing one of these gets its real name filled on first contact. */
const PLACEHOLDER_NAMES = new Set(["(unknown)", "unknown lead", "unknown", ""]);
function isPlaceholderName(n: string | null | undefined): boolean {
  return PLACEHOLDER_NAMES.has((n ?? "").trim().toLowerCase());
}

/** ilike with the wildcards escaped — an address containing "_" used to
 *  match other people. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => "\\" + c);
}

export interface PartyInput {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  /** Which writer is asking — stored on a created contact's notes and used to
   *  decide how much an automated/public source may change. */
  source: string;
  role?: string | null;
  company?: string | null;
  warmth?: "hot" | "warm" | "cool" | "cold" | "dormant" | null;
  contactType?: string | null;
}

export interface Party {
  contactId: string;
  created: boolean;
  matched: "email" | "phone+name" | "phone" | null;
  /** The contact's display name after resolution (may be a placeholder). */
  name: string | null;
}

export class RecordTouchError extends Error {
  constructor(message: string, public readonly context: Record<string, unknown> = {}) {
    super(message);
    this.name = "RecordTouchError";
  }
}

interface ContactRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}

/**
 * Resolve the person behind a message to a contact_id, creating one if
 * needed. Throws RecordTouchError when there is no identity at all (no
 * email, no phone, no name) — a message with nobody behind it is a bug in
 * the caller, not a row to store.
 *
 * Matching is fill-only: a resolved contact gains blanks (missing phone,
 * missing email, a placeholder name) but never has curated data replaced.
 * A second phone number is kept in contact_phones rather than dropped.
 */
export async function resolveParty(sb: SB, input: PartyInput): Promise<Party> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = (input.name ?? "").trim() || null;

  if (!email && !phone && !name) {
    throw new RecordTouchError("resolveParty: no email, phone, or name — cannot identify the person", {
      source: input.source,
    });
  }

  // ── 1. Email is identity ───────────────────────────────────────────────
  if (email) {
    const { data, error } = await sb
      .from("contacts")
      .select("id, full_name, email, phone, role")
      .eq("organization_id", ORG_ID)
      .ilike("email", escapeLike(email))
      .limit(1)
      .maybeSingle();
    if (error) throw new RecordTouchError(`resolveParty: email lookup failed: ${error.message}`, { email });
    if (data) {
      await fillBlanks(sb, data as ContactRow, { name, phone, email: null, role: input.role ?? null, source: input.source });
      return { contactId: data.id, created: false, matched: "email", name: data.full_name ?? name };
    }
  }

  // ── 2. Phone + matching name is identity ───────────────────────────────
  if (phone) {
    const candidates = await contactsWithPhone(sb, phone);
    if (name) {
      const byName = candidates.find((c) => nameSimilar(c.full_name, name));
      if (byName) {
        await fillBlanks(sb, byName, { name, phone: null, email, role: input.role ?? null, source: input.source });
        return { contactId: byName.id, created: false, matched: "phone+name", name: byName.full_name ?? name };
      }
    }
    // ── 3. Phone alone — anonymous caller/texter only ────────────────────
    // With neither an email nor a name there is nothing else to go on. If
    // several people share the number, the one we spoke with most recently
    // is the overwhelmingly likely sender; the ambiguity is still recorded.
    if (!email && !name && candidates.length > 0) {
      const pick = candidates.length === 1 ? candidates[0] : await mostRecentlyTouched(sb, candidates);
      return { contactId: pick.id, created: false, matched: "phone", name: pick.full_name };
    }
  }

  // ── 4. Genuinely new person ────────────────────────────────────────────
  const { data: created, error: insErr } = await sb
    .from("contacts")
    .insert({
      organization_id: ORG_ID,
      full_name: name ?? email ?? phone,
      email,
      phone,
      role: input.role ?? null,
      contact_type: input.contactType ?? "other",
      relationship_type: "prospect",
      warmth: input.warmth ?? "warm",
      notes: input.company ? `${input.source}: ${input.company}` : null,
      last_conversation: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();

  if (insErr) {
    // Unique email race (two webhooks for the same new person at once): the
    // other writer won — use their row.
    if (insErr.code === "23505" && email) {
      const { data: again } = await sb
        .from("contacts")
        .select("id, full_name")
        .eq("organization_id", ORG_ID)
        .ilike("email", escapeLike(email))
        .limit(1)
        .maybeSingle();
      if (again) return { contactId: again.id, created: false, matched: "email", name: again.full_name ?? name };
    }
    throw new RecordTouchError(`resolveParty: contact insert failed: ${insErr.message}`, { email, phone, name });
  }
  return { contactId: created.id, created: true, matched: null, name: name ?? email ?? phone };
}

/** Contacts reachable at this number: primary phone OR a known extra number. */
async function contactsWithPhone(sb: SB, phone: string): Promise<ContactRow[]> {
  const [{ data: primary }, { data: extra }] = await Promise.all([
    sb.from("contacts").select("id, full_name, email, phone, role").eq("organization_id", ORG_ID).eq("phone", phone),
    sb.from("contact_phones").select("contact:contacts(id, full_name, email, phone, role)").eq("organization_id", ORG_ID).eq("phone", phone),
  ]);
  const rows: ContactRow[] = [...((primary ?? []) as ContactRow[])];
  for (const r of (extra ?? []) as { contact: ContactRow | ContactRow[] | null }[]) {
    const c = Array.isArray(r.contact) ? r.contact[0] : r.contact;
    if (c && !rows.some((x) => x.id === c.id)) rows.push(c);
  }
  return rows;
}

async function mostRecentlyTouched(sb: SB, candidates: ContactRow[]): Promise<ContactRow> {
  const { data } = await sb
    .from("communications")
    .select("contact_id, occurred_at")
    .eq("organization_id", ORG_ID)
    .in("contact_id", candidates.map((c) => c.id))
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return candidates.find((c) => c.id === data?.contact_id) ?? candidates[0];
}

/** Fill-only enrichment. A different phone becomes an extra number, never a
 *  replacement; an email is set only when the contact has none (and backs
 *  off silently if another contact already owns it). */
async function fillBlanks(
  sb: SB,
  existing: ContactRow,
  fill: { name: string | null; phone: string | null; email: string | null; role: string | null; source: string }
): Promise<void> {
  const updates: Record<string, unknown> = { last_conversation: new Date().toISOString().slice(0, 10) };
  if (fill.name && isPlaceholderName(existing.full_name)) updates.full_name = fill.name;
  if (fill.role && !existing.role) updates.role = fill.role;
  if (fill.email && !existing.email) updates.email = fill.email;
  if (fill.phone) {
    if (!existing.phone) updates.phone = fill.phone;
    else if (existing.phone !== fill.phone) {
      await sb
        .from("contact_phones")
        .upsert(
          { organization_id: ORG_ID, contact_id: existing.id, phone: fill.phone, source: fill.source },
          { onConflict: "contact_id,phone", ignoreDuplicates: true }
        );
    }
  }
  const { error } = await sb.from("contacts").update(updates).eq("id", existing.id);
  if (error && updates.email) {
    // Email already belongs to someone else — keep the match, drop the fill.
    delete updates.email;
    await sb.from("contacts").update(updates).eq("id", existing.id);
  }
}

// ─────────────────────────────────────────────────────────────────────────

export type TouchChannel = "email" | "sms" | "phone" | "website";
export type TouchKind = "ai_followup" | "campaign" | "auto_ack" | "manual" | "internal";

export interface TouchInput {
  channel: TouchChannel;
  direction: "inbound" | "outbound";
  /** The person on the other end. Required unless touchKind is 'internal'. */
  contactId: string | null;
  leadId?: string | null;
  propertyId?: string | null;
  /** Provider id (Gmail message id, Twilio SID). Synthesized when absent. */
  externalId?: string | null;
  subject?: string | null;
  body?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[] | null;
  /** When it happened — the provider's timestamp, not "now", whenever known. */
  occurredAt?: string | null;
  touchKind?: TouchKind | null;
  attachments?: unknown[] | null;
  isRead?: boolean;
  /** Which writer produced this row. Stored as raw_payload.source. */
  source: string;
  rawPayload?: Record<string, unknown>;
}

export interface TouchResult {
  id: string;
  externalId: string;
  /** True when a row with this external_id already existed (webhook retry,
   *  concurrent poll). The existing row is returned; nothing was written. */
  duplicate: boolean;
}

/** Deterministic id for channels that give none (website forms, hand-logged
 *  calls). Same shape as the ids the Oct 2026 repair synthesized in SQL. */
export function synthExternalId(parts: Array<string | null | undefined>): string {
  const h = createHash("md5").update(parts.map((p) => p ?? "").join("|")).digest("hex");
  return `synth:${h}`;
}

/**
 * Write one communications row. Throws RecordTouchError on any failure —
 * callers that must not fail the request (webhooks that have to return
 * TwiML) catch it and alarm; nobody swallows it with a console.error.
 */
export async function recordTouch(sb: SB, t: TouchInput): Promise<TouchResult> {
  const touchKind = t.touchKind ?? null;
  if (!t.contactId && touchKind !== "internal") {
    throw new RecordTouchError("recordTouch: contact_id is required for every non-internal message", {
      source: t.source,
      channel: t.channel,
      direction: t.direction,
      from: t.fromAddress,
      to: t.toAddresses,
    });
  }
  const occurredAt = t.occurredAt ?? new Date().toISOString();
  const externalId =
    t.externalId ||
    synthExternalId([t.channel, t.direction, t.fromAddress, (t.toAddresses ?? []).join(","), occurredAt, (t.body ?? "").slice(0, 200)]);

  const { data, error } = await sb
    .from("communications")
    .insert({
      organization_id: ORG_ID,
      lead_id: t.leadId ?? null,
      contact_id: t.contactId,
      property_id: t.propertyId ?? null,
      channel: t.channel,
      direction: t.direction,
      external_id: externalId,
      subject: t.subject ?? null,
      body_preview: (t.body ?? "").slice(0, 500),
      from_address: t.fromAddress ?? null,
      to_addresses: t.toAddresses && t.toAddresses.length > 0 ? t.toAddresses : null,
      occurred_at: occurredAt,
      ...(t.isRead !== undefined ? { is_read: t.isRead } : {}),
      ...(touchKind ? { touch_kind: touchKind } : {}),
      attachments: t.attachments ?? [],
      raw_payload: { ...(t.rawPayload ?? {}), source: t.source },
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await sb
        .from("communications")
        .select("id")
        .eq("external_id", externalId)
        .limit(1)
        .maybeSingle();
      if (existing) return { id: existing.id, externalId, duplicate: true };
    }
    throw new RecordTouchError(`recordTouch: insert failed: ${error.message}`, {
      source: t.source,
      channel: t.channel,
      direction: t.direction,
      externalId,
      code: error.code,
    });
  }
  return { id: data.id, externalId, duplicate: false };
}

/**
 * Raise an operator alarm: SMS to John's cell + a row in email_ingest_log
 * so the integrity page can list it. Never throws — an alarm that fails
 * must not take the caller down with it.
 */
export async function alarm(sb: SB, kind: string, message: string, detail: Record<string, unknown> = {}): Promise<void> {
  console.error(`[alarm:${kind}] ${message}`, detail);
  try {
    await sb.from("email_ingest_log").insert({
      organization_id: ORG_ID,
      gmail_message_id: `alarm:${kind}:${Date.now()}`,
      disposition: "alarm",
      subject: message.slice(0, 200),
      detail: { kind, ...detail },
    });
  } catch (err) {
    console.error("[alarm] ledger write failed:", err instanceof Error ? err.message : err);
  }
  try {
    const { notifyJohn } = await import("@/lib/twilio-voice");
    await notifyJohn(`CRM alarm (${kind}): ${message}`.slice(0, 300));
  } catch (err) {
    console.error("[alarm] SMS failed:", err instanceof Error ? err.message : err);
  }
}
