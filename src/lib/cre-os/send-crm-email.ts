/**
 * sendCrmEmail — unified outbound email send utility.
 *
 * Every path that sends an email in the CRM MUST route through here so that:
 *   1. The communications row always has lead_id, property_id, and contact_id
 *   2. leads.status / final_sent_at are updated consistently when requested
 *   3. There is one place to change or audit outbound email bookkeeping
 *
 * linkOrphanedComms — run after any new leads row is created to retroactively
 * link prior orphaned communications rows (lead_id IS NULL) for the same
 * email address. Fixes the "invisible drawer thread" problem for contacts
 * whose CRM lead was created after their outreach history.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage } from "@/lib/gmail";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

/** Extract bare email from "Display Name <email@host>" or return as-is. */
function extractEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return m ? m[1].trim() : addr.trim();
}

export interface SendCrmEmailParams {
  // ── RFC 822 send params — forwarded directly to sendMessage() ──────────────
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;

  // ── CRM bookkeeping — all nullable; pass whatever the caller knows ─────────
  leadId: string | null;
  propertyId: string | null;
  contactId: string | null;

  /** 'manual' | 'bulk_ai' | 'ack' | 'lane_touch' | 'send_suggested_reply' | … */
  source?: string;

  /**
   * When true, also updates leads.status = 'sent' and final_sent_at.
   * Use for sends that represent "John replied to this lead" (manual, bulk-AI).
   * Leave false for auto-ack (which stamps auto_ack_sent_at instead) and for
   * lane_touch / send-reply sends that have no direct leads row.
   */
  updateLeadStatus?: boolean;

  /**
   * Extra columns merged into the leads UPDATE when updateLeadStatus is true.
   * Example: { final_reply: bodyText } for the manual send path.
   */
  additionalLeadUpdates?: Record<string, unknown>;

  /** Extra fields merged into raw_payload on the communications row. */
  rawPayloadExtra?: Record<string, unknown>;
}

export interface SendCrmEmailResult {
  gmailMessageId: string;
  gmailThreadId: string;
  sentAt: string;
}

/**
 * Map the caller's `source` tag onto the communications.touch_kind
 * vocabulary. touch_kind is the reporting dimension — it answers "what
 * KIND of outbound was this," which is coarser and more stable than
 * `source` (which names the specific code path and drifts as we add
 * routes).
 *
 *   ai_followup  — bulk AI follow-up to listing viewers
 *   campaign     — lane-driven prospecting outbound
 *   auto_ack     — automatic acknowledgement on a new inbound lead
 *   manual       — broker-written one-off
 *   internal     — system email to ourselves (Steward briefs)
 *
 * Unknown sources fall through to 'manual' — the safest default, since a
 * mislabeled one-off is less misleading in reports than a phantom
 * campaign or AI touch. If a new send path needs its own bucket, add the
 * case here rather than letting it land in manual silently.
 */
function touchKindForSource(source: string | undefined): string {
  switch (source) {
    case "bulk_ai":
    case "bulk-ai-followup":
      return "ai_followup";
    // NB: the /api/lane-touches/send route decides between "campaign" and
    // "manual" itself based on whether a lane was resolved — it can serve
    // either motion. Don't add its route name here.
    case "lane_touch":
    case "lane-touch":
    case "cadence":
    case "campaign":
      return "campaign";
    case "ack":
      return "auto_ack";
    case "steward_daily":
    case "steward_weekly":
      return "internal";
    default:
      return "manual";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendCrmEmail(
  supabase: SupabaseClient<any, any, any>,
  accessToken: string,
  params: SendCrmEmailParams
): Promise<SendCrmEmailResult> {
  // ── 1. Send via Gmail ───────────────────────────────────────────────────────
  const sent = await sendMessage(accessToken, {
    to: params.to,
    from: params.from,
    subject: params.subject,
    bodyText: params.bodyText,
    bodyHtml: params.bodyHtml,
    threadId: params.threadId,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });

  const sentAt = new Date().toISOString();

  // ── 2. Write the communications row with all foreign keys populated ─────────
  await supabase.from("communications").insert({
    organization_id: ORG_ID,
    lead_id: params.leadId,
    property_id: params.propertyId,
    contact_id: params.contactId,
    channel: "email",
    direction: "outbound",
    external_id: sent.id,
    subject: params.subject,
    body_preview: params.bodyText.slice(0, 500),
    from_address: extractEmail(params.from),
    to_addresses: [extractEmail(params.to)],
    occurred_at: sentAt,
    touch_kind: touchKindForSource(params.source),
    raw_payload: {
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      label_ids: sent.labelIds,
      source: params.source ?? "unknown",
      ...(params.rawPayloadExtra ?? {}),
    },
  });

  // ── 3. Optionally mark the lead as sent and stamp final_sent_at ─────────────
  if (params.updateLeadStatus && params.leadId) {
    await supabase
      .from("leads")
      .update({
        status: "sent",
        final_sent_at: sentAt,
        updated_at: sentAt,
        ...(params.additionalLeadUpdates ?? {}),
      })
      .eq("id", params.leadId);
  }

  return { gmailMessageId: sent.id, gmailThreadId: sent.threadId, sentAt };
}

/**
 * Before sending to a contact, call this to find or create the leads row so
 * every outbound communication has a lead_id and shows in the ContactDrawer.
 *
 * Returns the lead_id (existing or newly created), or null on failure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findOrCreateLeadForSend(
  supabase: SupabaseClient<any, any, any>,
  {
    recipientEmail,
    propertyId,
    contactId,
    senderName,
    source,
  }: {
    recipientEmail: string;
    propertyId: string;
    contactId: string | null;
    senderName: string | null;
    source: string;
  }
): Promise<string | null> {
  if (!recipientEmail || !propertyId) return null;
  const emailLower = recipientEmail.toLowerCase().trim();

  // 1. Look for an existing active lead for this email + property
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("property_id", propertyId)
    .ilike("sender_email", emailLower)
    .not("status", "in", '("archived","spam")')
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  // 2. No existing lead — create a minimal one so the send is anchored and
  //    visible in the ContactDrawer thread.
  const { data: created } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      property_id: propertyId,
      contact_id: contactId,
      sender_email: emailLower,
      sender_name: senderName ?? null,
      source,
      status: "sent",
      urgency: "warm",
    })
    .select("id")
    .single();

  if (created?.id) {
    // Retroactively link any prior orphaned communications for this contact
    await linkOrphanedComms(supabase, created.id, emailLower, propertyId);
  }

  return created?.id ?? null;
}

/**
 * After inserting a new leads row, call this to retroactively link any
 * orphaned communications rows (lead_id IS NULL) for the same email address.
 *
 * This fires two targeted UPDATEs — one for outbound rows (to_addresses
 * contains the email), one for inbound rows (from_address matches).
 * Uses an ilike substring match so minor formatting differences don't
 * prevent linking.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function linkOrphanedComms(
  supabase: SupabaseClient<any, any, any>,
  leadId: string,
  senderEmail: string | null,
  propertyId?: string | null
): Promise<void> {
  if (!senderEmail) return;
  const emailLower = senderEmail.toLowerCase().trim();
  const extra = propertyId ? { property_id: propertyId } : {};

  // Outbound rows sent TO this email (to_addresses stores bare email strings)
  await supabase
    .from("communications")
    .update({ lead_id: leadId, ...extra })
    .eq("organization_id", ORG_ID)
    .is("lead_id", null)
    .eq("direction", "outbound")
    .filter("to_addresses::text", "ilike", `%${emailLower}%`);

  // Inbound rows received FROM this email
  await supabase
    .from("communications")
    .update({ lead_id: leadId, ...extra })
    .eq("organization_id", ORG_ID)
    .is("lead_id", null)
    .eq("direction", "inbound")
    .ilike("from_address", emailLower);
}
