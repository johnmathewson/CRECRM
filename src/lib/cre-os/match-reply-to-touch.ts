/**
 * Match an inbound Gmail message to a lane_touch we previously sent.
 *
 * Called from the poll-gmail cron BEFORE dispatching to /api/leads/intake.
 * If the inbound message threads to a touch the agent sent (matched by
 * gmail_thread_id), we route it as a "reply" instead — log the reply in
 * lane_touches, flip the enrollment to 'engaged', and surface in the
 * Prospector Hot Replies queue.
 *
 * Returns `true` if the message was handled as a reply (caller should
 * NOT also dispatch to lead-intake). Returns `false` if no matching
 * touch was found (caller continues with normal inbound-lead path).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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

interface MatchedTouch {
  id: string;
  organization_id: string;
  enrollment_id: string | null;
  lane_id: string | null;
  property_id: string;
  contact_id: string | null;
}

export async function maybeRouteAsReply(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  msg: InboundMessage
): Promise<{ matched: boolean; touchId?: string }> {
  if (!msg.gmailThreadId) return { matched: false };

  // Find a sent touch with this thread id (most recent first).
  // Note: metadata is JSONB; we use the @> contains operator via .filter.
  const { data: candidates } = await supabase
    .from("lane_touches")
    .select("id, organization_id, enrollment_id, lane_id, property_id, contact_id, metadata")
    .eq("organization_id", ORG_ID)
    .eq("status", "sent")
    .filter("metadata->>gmail_thread_id", "eq", msg.gmailThreadId)
    .order("sent_at", { ascending: false })
    .limit(1);

  const parent = ((candidates ?? []) as MatchedTouch[])[0];
  if (!parent) return { matched: false };

  // 1. Insert a new lane_touches row for the inbound reply
  const { data: replyRow, error: replyErr } = await supabase
    .from("lane_touches")
    .insert({
      organization_id: ORG_ID,
      enrollment_id: parent.enrollment_id,
      lane_id: parent.lane_id,
      property_id: parent.property_id,
      contact_id: parent.contact_id,
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
        parent_touch_id: parent.id,
        from_email: msg.fromEmail,
        from_name: msg.fromName,
      },
    })
    .select("id")
    .single();
  if (replyErr) {
    console.error("[reply-match] failed to insert reply touch:", replyErr.message);
    return { matched: false };
  }

  // 2. Flip the parent touch's responded_at timestamp
  await supabase
    .from("lane_touches")
    .update({ responded_at: msg.receivedAt, status: "responded" })
    .eq("id", parent.id);

  // 3. Flip the enrollment to 'engaged' if present
  if (parent.enrollment_id) {
    await supabase
      .from("lane_enrollments")
      .update({
        status: "engaged",
        exit_reason: `Reply received from ${msg.fromEmail ?? "owner"}`,
      })
      .eq("organization_id", ORG_ID)
      .eq("id", parent.enrollment_id)
      .in("status", ["active", "paused"]);
  }

  // 4. Log an activity entry on the property timeline
  await supabase.from("activities").insert({
    organization_id: ORG_ID,
    activity_type: "email",
    subject: msg.subject ?? "Reply received",
    body: msg.bodyText.slice(0, 5000),
    occurred_at: msg.receivedAt,
    property_id: parent.property_id,
    contact_id: parent.contact_id,
  });

  return { matched: true, touchId: replyRow.id };
}
