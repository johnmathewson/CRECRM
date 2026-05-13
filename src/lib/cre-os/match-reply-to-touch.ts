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
  propertyId: string;
  contactId: string | null;
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
      parentSubject: touchHit.subject,
      parentBody: touchHit.body,
    };
  }

  // 2. Try communications (bulk-AI-followup landings only)
  const { data: commsRows } = await supabase
    .from("communications")
    .select("id, organization_id, property_id, subject, body_preview, raw_payload")
    .eq("organization_id", ORG_ID)
    .eq("direction", "outbound")
    .eq("channel", "email")
    .filter("raw_payload->>gmail_thread_id", "eq", threadId)
    .order("occurred_at", { ascending: false })
    .limit(1);
  const commHit = ((commsRows ?? []) as Array<{
    id: string;
    organization_id: string;
    property_id: string | null;
    subject: string | null;
    body_preview: string | null;
  }>)[0];
  if (commHit && commHit.property_id) {
    return {
      sourceTable: "communications",
      parentId: commHit.id,
      organizationId: commHit.organization_id,
      enrollmentId: null,
      laneId: null,
      propertyId: commHit.property_id,
      contactId: null,
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
  const { data: prop } = await supabase
    .from("properties")
    .select("name, address, asset_type")
    .eq("organization_id", ORG_ID)
    .eq("id", parent.propertyId)
    .maybeSingle();

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

  // ── 3. Insert the inbound lane_touches row ───────────────────────────
  const { data: replyRow, error: replyErr } = await supabase
    .from("lane_touches")
    .insert({
      organization_id: ORG_ID,
      enrollment_id: parent.enrollmentId,
      lane_id: parent.laneId,
      property_id: parent.propertyId,
      contact_id: parent.contactId,
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

  // ── 6. Activity entry on the property timeline (with the classification
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
