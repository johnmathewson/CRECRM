/**
 * Match an inbound Gmail message to a previous outbound, then classify
 * what the reply says using Claude. Two outbound sources are checked:
 *
 *   1. lane_touches — cadence-driven sends + manual SendTouches
 *   2. communications — bulk-AI-followup sends from the Leads tab
 *      (those don't write to lane_touches, only to communications)
 *
 * On match we:
 *   - Insert an inbound lane_touches row with status='responded'
 *   - Classify the reply with Claude (intent + summary + draft response)
 *   - Save the classification to lane_touches.metadata.classification
 *   - Flip the parent touch and enrollment (state changes)
 *   - For 'unsubscribe' intent: hard-exit the enrollment with exit_reason
 *   - For 'out_of_office': don't flip to engaged, leave the cadence running
 *   - Insert an activity row on the property timeline
 *
 * Returns true if handled as a reply (skip lead-intake), false otherwise.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyReply, type ReplyClassification } from "./classify-reply";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface InboundMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  bodyText: string;
  receivedAt: string;
}

interface MatchedSource {
  /** The thing we matched (a lane_touch row OR a communications row) */
  sourceTable: "lane_touches" | "communications";
  parentId: string;
  organizationId: string;
  enrollmentId: string | null;
  laneId: string | null;
  /** null when the matched communications row has no property (unmatched lead) */
  propertyId: string | null;
  contactId: string | null;
  /** The leads row this communications row belongs to — used to re-surface the
   *  lead in the worklist and write the inbound reply to the drawer thread. */
  leadId: string | null;
  /** What we sent — useful for classifying the reply */
  parentSubject: string | null;
  parentBody: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findMatch(supabase: SupabaseClient<any, any, any>, threadId: string): Promise<MatchedSource | null> {
  // 1. Try lane_touches (cadence + manual SendTouches)
  const { data: touchRows } = await supabase
    .from("lane_touches")
    .select("id, organization_id, enrollment_id, lane_id, property_id, contact_id, subject, body, metadata")
    .eq("organization_id", ORG_ID)
    .eq("status", "sent")
    .filter("metadata->>gmail_thread_id", "eq", threadId)
    .order("sent_at", { ascending: false })
    .limit(1);
  const touchHit = ((touchRows ?? []) as Array<{
    id: string;
    organization_id: string;
    enrollment_id: string | null;
    lane_id: string | null;
    property_id: string;
    contact_id: string | null;
    subject: string | null;
    body: string | null;
  }>)[0];
  if (touchHit) {
    return {
      sourceTable: "lane_touches",
      parentId: touchHit.id,
      organizationId: touchHit.organization_id,
      enrollmentId: touchHit.enrollment_id,
      laneId: touchHit.lane_id,
      propertyId: touchHit.property_id,
      contactId: touchHit.contact_id,
      leadId: null, // lane_touches don't have a direct lead_id
      parentSubject: touchHit.subject,
      parentBody: touchHit.body,
    };
  }

  // 2. Try communications — covers manual sends from leads/[id]/send AND
  //    bulk-AI-followup sends. Outbound rows have gmail_thread_id in raw_payload.
  const { data: commsRows } = await supabase
    .from("communications")
    .select("id, organization_id, lead_id, property_id, subject, body_preview, raw_payload")
    .eq("organization_id", ORG_ID)
    .eq("direction", "outbound")
    .eq("channel", "email")
    .filter("raw_payload->>gmail_thread_id", "eq", threadId)
    .order("occurred_at", { ascending: false })
    .limit(1);
  const commHit = ((commsRows ?? []) as Array<{
    id: string;
    organization_id: string;
    lead_id: string | null;
    property_id: string | null;
    subject: string | null;
    body_preview: string | null;
  }>)[0];
  if (commHit) {
    // property_id may be null on older rows that were inserted before the fix.
    // If missing, recover it from the linked lead row (one extra query, rare path).
    let propertyId = commHit.property_id ?? null;
    if (!propertyId && commHit.lead_id) {
      const { data: leadRow } = await supabase
        .from("leads")
        .select("property_id")
        .eq("id", commHit.lead_id)
        .maybeSingle();
      propertyId = (leadRow?.property_id as string | null) ?? null;
    }
    return {
      sourceTable: "communications",
      parentId: commHit.id,
      organizationId: commHit.organization_id,
      enrollmentId: null,
      laneId: null,
      propertyId,
      contactId: null,
      leadId: commHit.lead_id ?? null,
      parentSubject: commHit.subject,
      parentBody: commHit.body_preview,
    };
  }

  return null;
}

export async function maybeRouteAsReply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  msg: InboundMessage
): Promise<{ matched: boolean; touchId?: string; classification?: ReplyClassification }> {
  if (!msg.gmailThreadId) return { matched: false };

  const parent = await findMatch(supabase, msg.gmailThreadId);
  if (!parent) return { matched: false };

  // ── 1. Pull property + recipient context for classification ──────────
  const { data: prop } = parent.propertyId
    ? await supabase
        .from("properties")
        .select("name, address, asset_type")
        .eq("organization_id", ORG_ID)
        .eq("id", parent.propertyId)
        .maybeSingle()
    : { data: null };

  // ── 2. Classify the reply ────────────────────────────────────────────
  // Done synchronously so the inbox immediately surfaces the read. Adds
  // 2-4s to the poll-gmail loop per matched reply, but matters less than
  // surfacing the right intent to the broker on inbox refresh.
  let classification: ReplyClassification;
  try {
    classification = await classifyReply({
      inboundBody: msg.bodyText,
      inboundSubject: msg.subject,
      parentSubject: parent.parentSubject,
      parentBody: parent.parentBody,
      property: prop ? {
        name: prop.name,
        address: prop.address,
        assetType: prop.asset_type,
      } : undefined,
      recipient: {
        name: msg.fromName,
      },
    });
  } catch (err) {
    console.error("[reply-match] classifyReply threw:", err);
    classification = {
      intent: "unclear",
      confidence: 0,
      summary: "(Classifier threw an error)",
      suggestedReply: "",
      classifiedAt: new Date().toISOString(),
      model: "n/a",
    };
  }

  // ── 2b. Resolve a contact_id if the parent didn't carry one ──────────
  // When the reply matched a communications-source parent (bulk-ai-followup
  // path), parent.contactId is NULL. Look up the contact by from_email so
  // the reply lane_touch links correctly and surfaces on the Leads tab.
  let resolvedContactId = parent.contactId;
  if (!resolvedContactId && msg.fromEmail) {
    const { data: contactRow } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", ORG_ID)
      .ilike("email", msg.fromEmail.trim())
      .maybeSingle();
    if (contactRow) resolvedContactId = contactRow.id as string;
  }

  // ── 3. Insert the inbound lane_touches row ───────────────────────────
  const { data: replyRow, error: replyErr } = await supabase
    .from("lane_touches")
    .insert({
      organization_id: ORG_ID,
      enrollment_id: parent.enrollmentId,
      lane_id: parent.laneId,
      property_id: parent.propertyId,
      contact_id: resolvedContactId,
      step_index: 0,
      channel: "email",
      status: "responded",
      responded_at: msg.receivedAt,
      subject: msg.subject,
      body: msg.bodyText,
      metadata: {
        direction: "inbound",
        gmail_message_id: msg.gmailMessageId,
        gmail_thread_id: msg.gmailThreadId,
        parent_id: parent.parentId,
        parent_source: parent.sourceTable,
        from_email: msg.fromEmail,
        from_name: msg.fromName,
        classification,
      },
    })
    .select("id")
    .single();
  if (replyErr) {
    console.error("[reply-match] failed to insert reply touch:", replyErr.message);
    return { matched: false };
  }

  // ── 4. Flip parent state (only meaningful for lane_touches parents) ──
  if (parent.sourceTable === "lane_touches") {
    await supabase
      .from("lane_touches")
      .update({ responded_at: msg.receivedAt, status: "responded" })
      .eq("id", parent.parentId);
  }

  // ── 5. Update enrollment based on intent ──────────────────────────────
  if (parent.enrollmentId) {
    let nextStatus: string;
    let exitReason: string;
    if (classification.intent === "unsubscribe") {
      nextStatus = "exited_dnc";
      exitReason = `Unsubscribe via reply from ${msg.fromEmail ?? "owner"}`;
    } else if (classification.intent === "declined") {
      nextStatus = "exited_no_response"; // closer to "polite no" than DNC
      exitReason = `Polite decline from ${msg.fromEmail ?? "owner"}: ${classification.summary}`;
    } else if (classification.intent === "out_of_office") {
      // Don't flip — let the cadence keep running, they'll be back
      nextStatus = "active";
      exitReason = `Out of office (cadence continues)`;
    } else {
      // interested / question / hostile / unclear → engaged for human review
      nextStatus = "engaged";
      exitReason = `Reply received from ${msg.fromEmail ?? "owner"}: ${classification.summary}`;
    }

    if (nextStatus !== "active") {
      await supabase
        .from("lane_enrollments")
        .update({
          status: nextStatus,
          exited_at: ["exited_dnc", "exited_no_response"].includes(nextStatus)
            ? msg.receivedAt
            : null,
          exit_reason: exitReason,
        })
        .eq("organization_id", ORG_ID)
        .eq("id", parent.enrollmentId)
        .in("status", ["active", "paused"]);
    }
  }

  // ── 6. Re-surface the lead in the worklist + write to the drawer thread ──
  // Only applies when this reply was triggered by a manual send from
  // leads/[id]/send (sourceTable === "communications" && leadId is set).
  // Cadence lane_touches replies don't have a direct leads row to update.
  if (parent.leadId) {
    // Write the inbound reply to communications so it appears in the
    // ContactDrawer thread alongside John's outbound reply.
    await supabase.from("communications").insert({
      organization_id: ORG_ID,
      lead_id: parent.leadId,
      contact_id: resolvedContactId,
      property_id: parent.propertyId ?? null,
      channel: "email",
      direction: "inbound",
      external_id: msg.gmailMessageId,
      subject: msg.subject,
      body_preview: msg.bodyText.slice(0, 500),
      from_address: msg.fromEmail,
      occurred_at: msg.receivedAt,
      raw_payload: {
        gmail_message_id: msg.gmailMessageId,
        gmail_thread_id: msg.gmailThreadId,
        from_name: msg.fromName,
        classification,
      },
    });

    // Re-open the lead so it surfaces in "Do This Now" and the AI can draft
    // a response to what they said. Only re-open if it was in 'sent' status
    // (don't clobber a lead that John already re-opened manually).
    // Clear final_sent_at too — DoThisNow.priority() checks finalSent, so a
    // re-opened lead with final_sent_at still set would be invisible in the queue.
    await supabase
      .from("leads")
      .update({
        status: "new",
        draft_reply: null, // cleared so draftLeadReply can produce a fresh reply
        final_sent_at: null, // cleared so the lead shows in the action queue
        raw_subject: msg.subject, // reply subject — used by draftLeadReply first_touch
        raw_body: msg.bodyText.slice(0, 5000), // reply body — used for drafting context
        qualifier_summary: classification.summary || undefined,
        updated_at: msg.receivedAt,
      })
      .eq("id", parent.leadId)
      .in("status", ["sent"]);

    // Lead-level event visible in the drawer activity tab
    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: parent.leadId,
      event_type: "replied",
      actor: "system",
      summary: `${msg.fromName || msg.fromEmail || "Contact"} replied — ${classification.summary}`,
      metadata: {
        gmail_message_id: msg.gmailMessageId,
        gmail_thread_id: msg.gmailThreadId,
        intent: classification.intent,
        confidence: classification.confidence,
      },
    });
  }

  // ── 7. Activity entry on the property timeline (with the classification
  //       summary in the subject so it's visible at a glance) ────────────
  const summaryPrefix =
    classification.intent !== "unclear" && classification.confidence >= 0.6
      ? `[${classification.intent.toUpperCase().replace(/_/g, " ")}] `
      : "";
  await supabase.from("activities").insert({
    organization_id: ORG_ID,
    activity_type: "email",
    subject: summaryPrefix + (msg.subject ?? "Reply received"),
    body: msg.bodyText.slice(0, 5000),
    occurred_at: msg.receivedAt,
    property_id: parent.propertyId,
    contact_id: parent.contactId,
  });

  return { matched: true, touchId: replyRow.id, classification };
}
