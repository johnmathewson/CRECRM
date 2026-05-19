/**
 * POST /api/lane-touches/send
 *
 * Manually send a one-off email touch for a specific property. Used by the
 * "Send touch now" button on cold-inventory rows + the inbox compose form.
 * Mirrors what the cadence runner will do automatically.
 *
 * Body:
 *   {
 *     propertyId: string                  (required)
 *     to: string                          (recipient email — required if no contactId)
 *     contactId?: string                  (existing contact, optional)
 *     toName?: string                     (display name for recipient)
 *     subject: string
 *     bodyText: string
 *     laneId?: string                     (tag this touch with a lane)
 *     enrollmentId?: string               (if part of an existing cadence run)
 *     stepIndex?: number
 *   }
 *
 * Side effects:
 *   - Gmail messages.send (real send)
 *   - lane_touches row at status='sent' with metadata.gmail_thread_id
 *   - activities row for the property timeline
 *   - Returns the new lane_touches row
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { sendMessage } from "@/lib/gmail";
import { captureVoiceExample } from "@/lib/cre-os/voice-examples";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

/**
 * Build a compact, human-readable diff between the AI's original draft and
 * what the broker actually sent. Stored in voice_examples.user_edits_diff
 * and fed to the learn-from-edits analyzer so Claude can spot patterns
 * (broker keeps removing X, broker keeps adding Y at the end, etc).
 */
function buildEditDiff(originalBody: string, sentBody: string, originalSubject: string | null, sentSubject: string): string {
  const parts: string[] = [];
  if (originalSubject && originalSubject !== sentSubject) {
    parts.push(`SUBJECT CHANGED:\n  AI: ${originalSubject}\n  Sent: ${sentSubject}`);
  }
  parts.push(`AI ORIGINAL BODY:\n${originalBody}`);
  parts.push(`BROKER SENT:\n${sentBody}`);
  return parts.join("\n\n---\n\n");
}
const SEND_DISPLAY_NAME = "John Mathewson";

interface Body {
  propertyId: string;
  to?: string;
  contactId?: string;
  toName?: string;
  subject: string;
  bodyText: string;
  laneId?: string;
  enrollmentId?: string;
  stepIndex?: number;
  channel?: "email";
  // Voice-example capture hints — optional. When set, used to tag the
  // captured voice_examples row so future few-shot retrieval can find it.
  aiDrafted?: boolean;     // true when the body came from "Generate AI draft"
  personaSlug?: string;    // the persona used for the AI draft, if any
  // NEW: pass the ORIGINAL AI draft body so the route can detect whether
  // the broker edited it before sending. Used to compute user_edits_diff
  // (what the broker changed) — drives the learn-from-edits training pass.
  aiDraftOriginalBody?: string;
  aiDraftOriginalSubject?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.propertyId) return NextResponse.json({ error: "propertyId required" }, { status: 400 });
  if (!body.subject?.trim()) return NextResponse.json({ error: "subject required" }, { status: 400 });
  if (!body.bodyText?.trim()) return NextResponse.json({ error: "bodyText required" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Resolve recipient — explicit `to` wins, else look up the contact
  let recipientEmail = body.to?.trim();
  let recipientName = body.toName?.trim();
  let resolvedContactId = body.contactId ?? null;

  if (!recipientEmail && body.contactId) {
    const { data: c } = await supabase
      .from("contacts")
      .select("id, full_name, email")
      .eq("organization_id", ORG_ID)
      .eq("id", body.contactId)
      .maybeSingle();
    if (c?.email) {
      recipientEmail = c.email;
      recipientName = recipientName ?? c.full_name ?? undefined;
      resolvedContactId = c.id;
    }
  }
  if (!recipientEmail) {
    return NextResponse.json({ error: "Recipient email required (pass `to` or a contactId with email)" }, { status: 400 });
  }

  // Property must exist
  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select("id, name, address, organization_id")
    .eq("organization_id", ORG_ID)
    .eq("id", body.propertyId)
    .maybeSingle();
  if (propErr || !prop) return NextResponse.json({ error: "Property not found" }, { status: 404 });

  // Gmail token
  let token;
  try {
    token = await getActiveGmailToken(supabase);
  } catch (err) {
    return NextResponse.json(
      { error: `Gmail token refresh failed: ${err instanceof Error ? err.message : err}. Reconnect at /cre-os/settings.` },
      { status: 500 }
    );
  }
  if (!token) {
    return NextResponse.json(
      { error: "Gmail not connected. Connect at /cre-os/settings." },
      { status: 412 }
    );
  }

  const fromHeader = `${SEND_DISPLAY_NAME} <${token.email}>`;
  const toHeader = recipientName ? `"${recipientName}" <${recipientEmail}>` : recipientEmail;

  // Send
  let sent;
  try {
    sent = await sendMessage(token.accessToken, {
      to: toHeader,
      from: fromHeader,
      subject: body.subject,
      bodyText: body.bodyText,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Gmail send failed: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }

  const sentAt = new Date().toISOString();

  // Insert activity entry first so we can link from lane_touches
  const { data: activity } = await supabase
    .from("activities")
    .insert({
      organization_id: ORG_ID,
      activity_type: "email",
      subject: body.subject,
      body: body.bodyText,
      occurred_at: sentAt,
      property_id: prop.id,
      contact_id: resolvedContactId,
    })
    .select("id")
    .single();

  // Lookup lane_id from enrollment if we have one (otherwise rely on the
  // caller's laneId, or null for true one-off sends).
  let resolvedLaneId = body.laneId ?? null;
  if (body.enrollmentId && !body.laneId) {
    const { data: enr } = await supabase
      .from("lane_enrollments")
      .select("lane_id")
      .eq("organization_id", ORG_ID)
      .eq("id", body.enrollmentId)
      .maybeSingle();
    resolvedLaneId = enr?.lane_id ?? null;
  }

  // Migration 0026 made enrollment_id + lane_id nullable so manual one-off
  // sends can land in lane_touches alongside cadence-driven sends.
  const { data: touch, error: touchErr } = await supabase
    .from("lane_touches")
    .insert({
      organization_id: ORG_ID,
      enrollment_id: body.enrollmentId ?? null,
      lane_id: resolvedLaneId,
      property_id: prop.id,
      contact_id: resolvedContactId,
      step_index: body.stepIndex ?? 0,
      channel: "email",
      status: "sent",
      sent_at: sentAt,
      subject: body.subject,
      body: body.bodyText,
      activity_id: activity?.id ?? null,
      metadata: {
        gmail_message_id: sent.id,
        gmail_thread_id: sent.threadId,
        to: recipientEmail,
        to_name: recipientName ?? null,
        from: token.email,
        manual: !body.enrollmentId,
      },
    })
    .select("id")
    .single();

  if (touchErr) {
    return NextResponse.json({
      ok: true,
      warning: `Email sent but lane_touches insert failed: ${touchErr.message}`,
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      activity_id: activity?.id,
    });
  }
  const touchId = touch.id;

  // Also write to communications so the Leads-tab state machine and any
  // downstream reporting that joins on communications.to_addresses can see
  // this send. (Historically this route only wrote to lane_touches, which
  // caused leads to NOT show as Touched after a Compose+Send.)
  await supabase.from("communications").insert({
    organization_id: ORG_ID,
    property_id: body.propertyId,
    channel: "email",
    direction: "outbound",
    external_id: sent.id,
    subject: body.subject,
    body_preview: body.bodyText.slice(0, 500),
    from_address: token.email,
    to_addresses: [recipientEmail],
    occurred_at: sentAt,
    raw_payload: {
      gmail_message_id: sent.id,
      gmail_thread_id: sent.threadId,
      source: "lane-touches-send",
      lane_touch_id: touchId,
      activity_id: activity?.id,
    },
  });

  // Determine the precise source — manual / ai_drafted / ai_edited —
  // based on whether the caller passed the original AI draft AND whether
  // the broker actually edited it before sending.
  let source: "manual" | "ai_drafted" | "ai_edited" = "manual";
  let userEditsDiff: string | null = null;
  if (body.aiDrafted) {
    const origBody = (body.aiDraftOriginalBody ?? "").trim();
    const sentBody = (body.bodyText ?? "").trim();
    if (origBody && origBody !== sentBody) {
      // Broker edited the AI draft. Capture the diff for future analysis.
      source = "ai_edited";
      userEditsDiff = buildEditDiff(origBody, sentBody, body.aiDraftOriginalSubject ?? null, body.subject);
    } else {
      // AI drafted, broker sent without edits (or didn't provide original)
      source = "ai_drafted";
    }
  }

  await captureVoiceExample(supabase, {
    channel: "email",
    subject: body.subject,
    body: body.bodyText,
    source,
    userEditsDiff,
    personaSlug: body.personaSlug ?? null,
    propertyId: body.propertyId,
    recipientProfileSnapshot: {
      to: recipientEmail,
      to_name: recipientName ?? null,
    },
    sentAt,
  });

  return NextResponse.json({
    ok: true,
    sent_at: sentAt,
    gmail_message_id: sent.id,
    gmail_thread_id: sent.threadId,
    activity_id: activity?.id,
    lane_touch_id: touchId,
  });
}
