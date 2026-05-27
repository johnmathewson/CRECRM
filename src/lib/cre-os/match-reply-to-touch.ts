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
import { linkOrphanedComms } from "./send-crm-email";

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

  // ── 5b. Resolve (or create) a lead for cadence/lane_touches-source replies ─
  // When the matched parent is a lane_touch, parent.leadId is null. Look up
  // the existing lead for this contact+property, or create a minimal one, so
  // step 6 can re-surface it in the main inbox exactly the same way that
  // communications-source replies are already handled.
  let resolvedLeadId = parent.leadId;
  if (parent.sourceTable === "lane_touches" && !resolvedLeadId) {
    const lookupContactId = resolvedContactId;
    if (lookupContactId && parent.propertyId) {
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("organization_id", ORG_ID)
        .eq("contact_id", lookupContactId)
        .eq("property_id", parent.propertyId)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingLead) {
        resolvedLeadId = (existingLead as { id: string }).id;
      } else if (msg.fromEmail) {
        // No lead yet — create a minimal one so the reply surfaces in the
        // broker's main inbox. linkOrphanedComms will retroactively link any
        // prior cadence outbound comms that were written with lead_id = null.
        const { data: newLead } = await supabase
          .from("leads")
          .insert({
            organization_id: ORG_ID,
            contact_id: lookupContactId,
            property_id: parent.propertyId,
            source: "cadence_reply",
            status: "new",
            urgency: "warm",
            sender_email: msg.fromEmail,
            sender_name: msg.fromName ?? msg.fromEmail,
            raw_subject: msg.subject,
            raw_body: msg.bodyText.slice(0, 5000),
            qualifier_summary: classification.summary || undefined,
          })
          .select("id")
          .single();
        if (newLead) {
          resolvedLeadId = (newLead as { id: string }).id;
          // Pull in any prior orphaned outbound comms (cadence sends that were
          // written with lead_id = null before this lead existed).
          await linkOrphanedComms(supabase, resolvedLeadId, msg.fromEmail, parent.propertyId);
        }
      }
    }
  }

  // ── 6. Re-surface the lead in the worklist + write to the drawer thread ──
  // Now runs for BOTH communications-source and lane_touches-source replies.
  // This is the fix that makes cadence replies visible in the main inbox and
  // ContactDrawer — previously only communications-source replies triggered this.
  if (resolvedLeadId) {
    // Write the inbound reply to communications so it appears in the
    // ContactDrawer thread alongside John's outbound messages.
    // Guard with external_id dedup so a retry doesn't double-insert.
    const { data: alreadyLogged } = await supabase
      .from("communications")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("external_id", msg.gmailMessageId)
      .maybeSingle();

    if (!alreadyLogged) {
      await supabase.from("communications").insert({
        organization_id: ORG_ID,
        lead_id: resolvedLeadId,
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
          source: parent.sourceTable === "lane_touches" ? "cadence_reply" : "direct_reply",
        },
      });
    }

    // Re-open the lead so it surfaces in "Do This Now" and the AI can draft
    // a response. Only re-open if it was in 'sent' status or 'new' (just
    // created above). Don't clobber a lead John already re-opened manually.
    // Clear final_sent_at — DoThisNow.priority() checks finalSent, so a
    // re-opened lead with final_sent_at still set would be invisible in queue.
    await supabase
      .from("leads")
      .update({
        status: "new",
        draft_reply: null,            // cleared so draftLeadReply produces a fresh response
        final_sent_at: null,          // cleared so the lead shows in the action queue
        raw_subject: msg.subject,     // reply subject — context for AI drafting
        raw_body: msg.bodyText.slice(0, 5000), // reply body — context for AI drafting
        qualifier_summary: classification.summary || undefined,
        updated_at: msg.receivedAt,
      })
      .eq("id", resolvedLeadId)
      .in("status", ["sent", "new"]);

    // Lead-level event visible in the drawer activity tab
    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: resolvedLeadId,
      event_type: "replied",
      actor: "system",
      summary: `${msg.fromName || msg.fromEmail || "Contact"} replied — ${classification.summary}`,
      metadata: {
        gmail_message_id: msg.gmailMessageId,
        gmail_thread_id: msg.gmailThreadId,
        intent: classification.intent,
        confidence: classification.confidence,
        source: parent.sourceTable,
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

/**
 * Email-based fallback for cadence replies where the Gmail thread-id changed
 * (forwarded, contact replied from a different client, etc.).
 *
 * Called by poll-gmail when the AI classifies an inbound email as
 * "cadence_reply" but maybeRouteAsReply() returned matched=false.
 *
 * Strategy: find the most recent outbound communications row sent to
 * msg.fromEmail in the last 60 days. If found, run the same classification +
 * inbound communications insert + lead re-surface as a normal reply match —
 * but skip the lane_touches/enrollment side (there's no enrollment to update
 * since we lost the thread link).
 */
export async function routeAsReplyByEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  msg: InboundMessage
): Promise<{ matched: boolean }> {
  if (!msg.fromEmail) return { matched: false };

  const emailLower = msg.fromEmail.toLowerCase().trim();
  const cutoffDate = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();

  // Find most recent outbound we sent to this address
  const { data: outboundRow } = await supabase
    .from("communications")
    .select("id, lead_id, property_id, contact_id, subject, body_preview")
    .eq("organization_id", ORG_ID)
    .eq("direction", "outbound")
    .eq("channel", "email")
    .gte("occurred_at", cutoffDate)
    .filter("to_addresses::text", "ilike", `%${emailLower}%`)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!outboundRow) return { matched: false };

  const row = outboundRow as {
    id: string;
    lead_id: string | null;
    property_id: string | null;
    contact_id: string | null;
    subject: string | null;
    body_preview: string | null;
  };

  // Dedup: don't double-insert if this Gmail message was already logged
  const { data: alreadyLogged } = await supabase
    .from("communications")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("external_id", msg.gmailMessageId)
    .maybeSingle();
  if (alreadyLogged) return { matched: true }; // already handled

  // Classify the reply
  let classification: ReplyClassification;
  try {
    const { data: prop } = row.property_id
      ? await supabase
          .from("properties")
          .select("name, address, asset_type")
          .eq("organization_id", ORG_ID)
          .eq("id", row.property_id)
          .maybeSingle()
      : { data: null };
    classification = await classifyReply({
      inboundBody: msg.bodyText,
      inboundSubject: msg.subject,
      parentSubject: row.subject,
      parentBody: row.body_preview,
      property: prop ? { name: prop.name, address: prop.address, assetType: prop.asset_type } : undefined,
      recipient: { name: msg.fromName },
    });
  } catch {
    classification = { intent: "unclear", confidence: 0, summary: "(Classifier error)", suggestedReply: "", classifiedAt: new Date().toISOString(), model: "n/a" };
  }

  // Resolve contact_id
  let resolvedContactId = row.contact_id;
  if (!resolvedContactId) {
    const { data: ct } = await supabase
      .from("contacts")
      .select("id")
      .eq("organization_id", ORG_ID)
      .ilike("email", msg.fromEmail.trim())
      .maybeSingle();
    if (ct) resolvedContactId = (ct as { id: string }).id;
  }

  // Re-open / create lead
  let resolvedLeadId = row.lead_id;
  if (!resolvedLeadId && resolvedContactId && row.property_id) {
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("contact_id", resolvedContactId)
      .eq("property_id", row.property_id)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    resolvedLeadId = (existingLead as { id: string } | null)?.id ?? null;
  }

  // Write inbound communications row
  await supabase.from("communications").insert({
    organization_id: ORG_ID,
    lead_id: resolvedLeadId,
    contact_id: resolvedContactId,
    property_id: row.property_id,
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
      source: "cadence_reply_email_fallback",
    },
  });

  // Re-open the lead if we found one
  if (resolvedLeadId) {
    await supabase
      .from("leads")
      .update({
        status: "new",
        draft_reply: null,
        final_sent_at: null,
        raw_subject: msg.subject,
        raw_body: msg.bodyText.slice(0, 5000),
        qualifier_summary: classification.summary || undefined,
        updated_at: msg.receivedAt,
      })
      .eq("id", resolvedLeadId)
      .in("status", ["sent", "new"]);

    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: resolvedLeadId,
      event_type: "replied",
      actor: "system",
      summary: `${msg.fromName || msg.fromEmail} replied (thread changed) — ${classification.summary}`,
      metadata: { gmail_message_id: msg.gmailMessageId, intent: classification.intent, source: "email_fallback" },
    });
  }

  return { matched: true };
}
