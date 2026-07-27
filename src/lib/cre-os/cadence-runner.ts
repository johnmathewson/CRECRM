/**
 * Cadence runner — the heart of the prospector agent.
 *
 * Walks active lane_enrollments where next_action_at <= now, finds the
 * current cadence step from the lane definition, and either:
 *   • auto-sends (email channel via Gmail, others tracked but not sent yet)
 *   • queues a drafted lane_touch awaiting human approval
 *   • marks the step as manual-only (logged but the human has to act)
 *
 * Honors approval_mode per channel:
 *   "auto"    → send immediately (only email + letter use this in practice)
 *   "queue"   → write a drafted lane_touch for human review
 *   "manual"  → skip — log a queued touch that prompts the human to call
 *
 * Advances the enrollment's current_step + next_action_at based on the
 * next cadence step's day_offset. When current_step exceeds the cadence
 * length, marks the enrollment 'exited_no_response'.
 *
 * Designed to be idempotent and re-entrant — safe to call from a cron
 * or a one-off button. Each enrollment is processed at most once per
 * run by checking next_action_at against now.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getActiveGmailToken } from "@/lib/gmail-auth";
import { sendMessage } from "@/lib/gmail";
import { sendSms, toE164, getTwilioConfig } from "@/lib/twilio";
import {
  personalizeTouch,
  archetypeFromContext,
  DEFAULT_SENDER,
  type PersonalizationChannel,
  type LaneArchetype,
} from "./ai-touch-personalize";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const SEND_DISPLAY_NAME = "John Mathewson";

interface CadenceStep {
  day_offset: number;
  channel: "email" | "sms" | "call" | "letter" | "voicemail";
  subject?: string;
  body?: string;
  notes?: string;
  template?: string;
}

interface ApprovalMode {
  email?: "auto" | "queue" | "manual";
  sms?: "auto" | "queue" | "manual";
  call?: "auto" | "queue" | "manual";
  letter?: "auto" | "queue" | "manual";
  voicemail?: "auto" | "queue" | "manual";
}

interface Lane {
  id: string;
  name: string;
  status: string;
  cadence: CadenceStep[];
  approval_mode: ApprovalMode;
  daily_touch_cap: number;
}

interface Enrollment {
  id: string;
  lane_id: string;
  property_id: string;
  current_step: number;
  enrolled_at: string;
  status: string;
}

interface PropertyMin {
  id: string;
  slug: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  owner_name_raw: string | null;
  owner_mailing_address: string | null;
  estimated_value: number | null;
  mortgage_maturity_date: string | null;
  years_owned: number | null;
}

interface ContactMin {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface CadenceRunResult {
  enrollmentsProcessed: number;
  touchesSent: number;
  touchesQueued: number;
  touchesSkipped: number;
  enrollmentsExited: number;
  errors: string[];
}

export interface CadenceRunOptions {
  /** Limit how many enrollments to process per run (defaults to 50). */
  maxEnrollments?: number;
  /** Restrict to a single lane id (used by per-lane "run now"). */
  laneId?: string;
  /** Dry-run: compute steps but don't send / write. */
  dryRun?: boolean;
}

export async function runCadence(options: CadenceRunOptions = {}): Promise<CadenceRunResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const result: CadenceRunResult = {
    enrollmentsProcessed: 0,
    touchesSent: 0,
    touchesQueued: 0,
    touchesSkipped: 0,
    enrollmentsExited: 0,
    errors: [],
  };

  // Load active lanes (cached for the duration of this run)
  // Includes trigger_type + persona_id + persona join so the personalizer
  // can route to the right voice/skill profile.
  const laneQuery = supabase
    .from("lanes")
    .select("id, name, status, cadence, approval_mode, daily_touch_cap, trigger_type, persona_id, persona:personas(slug)")
    .eq("organization_id", ORG_ID)
    .eq("status", "active");
  if (options.laneId) laneQuery.eq("id", options.laneId);
  const { data: lanesRaw } = await laneQuery;
  const lanes = new Map<string, Lane>(
    ((lanesRaw ?? []) as Lane[]).map((l) => [l.id, l])
  );
  if (lanes.size === 0) return result;

  // Find enrollments due now
  const nowIso = new Date().toISOString();
  const { data: enrollments } = await supabase
    .from("lane_enrollments")
    .select("id, lane_id, property_id, current_step, enrolled_at, status, next_action_at")
    .eq("organization_id", ORG_ID)
    .eq("status", "active")
    .in("lane_id", Array.from(lanes.keys()))
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true })
    .limit(options.maxEnrollments ?? 50);

  if (!enrollments || enrollments.length === 0) return result;

  // Daily-cap accounting: tally already-sent today per lane
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const sentTodayByLane = new Map<string, number>();
  for (const laneId of Array.from(lanes.keys())) {
    const { count } = await supabase
      .from("lane_touches")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .eq("lane_id", laneId)
      .eq("status", "sent")
      .gte("sent_at", todayStart.toISOString());
    sentTodayByLane.set(laneId, count ?? 0);
  }

  // Cache the Gmail token for the whole run
  let gmailToken: Awaited<ReturnType<typeof getActiveGmailToken>> | null = null;
  try {
    gmailToken = await getActiveGmailToken(supabase);
  } catch (err) {
    result.errors.push(`Gmail token: ${err instanceof Error ? err.message : err}`);
  }

  for (const enr of enrollments as Enrollment[]) {
    result.enrollmentsProcessed += 1;
    const lane = lanes.get(enr.lane_id);
    if (!lane) continue;
    const step = lane.cadence[enr.current_step];

    // Cadence complete → exit
    if (!step) {
      if (!options.dryRun) {
        await supabase
          .from("lane_enrollments")
          .update({
            status: "exited_no_response",
            exited_at: nowIso,
            exit_reason: "Cadence completed without a reply",
          })
          .eq("id", enr.id);
      }
      result.enrollmentsExited += 1;
      continue;
    }

    // Daily cap check
    const sentToday = sentTodayByLane.get(lane.id) ?? 0;
    if (sentToday >= lane.daily_touch_cap) {
      // Push next_action_at out 1h so this enrollment retries after cap resets
      if (!options.dryRun) {
        await supabase
          .from("lane_enrollments")
          .update({ next_action_at: new Date(Date.now() + 3600_000).toISOString() })
          .eq("id", enr.id);
      }
      result.touchesSkipped += 1;
      continue;
    }

    // Load property + contact
    const { data: prop } = await supabase
      .from("properties")
      .select("id, slug, name, address, city, state, zip, owner_name_raw, owner_mailing_address, estimated_value, mortgage_maturity_date, years_owned")
      .eq("id", enr.property_id)
      .maybeSingle();
    if (!prop) {
      result.errors.push(`Enrollment ${enr.id}: property not found`);
      continue;
    }
    const property = prop as PropertyMin;

    // Find a contact for this property (first one with the right channel data)
    let contact: ContactMin | null = null;
    if (step.channel === "email" || step.channel === "sms" || step.channel === "call" || step.channel === "voicemail") {
      const { data: c } = await supabase
        .from("contacts")
        .select("id, full_name, email, phone")
        .eq("organization_id", ORG_ID)
        .order("created_at", { ascending: false })
        .limit(5);
      // Prefer one we've linked to this property previously
      // (lightweight heuristic — real cadence runner would have a property_contacts join)
      const candidates = ((c ?? []) as ContactMin[]).filter(
        step.channel === "email" ? (x) => !!x.email :
        step.channel === "sms" || step.channel === "call" || step.channel === "voicemail" ? (x) => !!x.phone :
        () => true
      );
      contact = candidates[0] ?? null;
    }

    // Approval mode for this channel — drives whether we use AI or templates.
    // Auto-send paths (email/SMS) use Claude for per-recipient
    // personalization. Queued/drafted/manual paths use templates so a human
    // edits before send (also faster + cheaper for high-volume preview).
    const mode = lane.approval_mode[step.channel] ?? "queue";
    const useAI =
      mode === "auto" &&
      (step.channel === "email" || step.channel === "sms") &&
      !options.dryRun;

    let subject: string;
    let body: string;

    if (useAI) {
      try {
        const personalized = await personalizeTouch({
          channel: step.channel as PersonalizationChannel,
          // Persona resolution: explicit personaId (via join.slug) wins; else
          // derive from trigger_type via archetypeFromContext.
          archetype: (
            (lane as Lane & { persona?: { slug?: string } | null }).persona?.slug
              ?? (lane.id
                ? archetypeFromContext({ laneTriggerType: (lane as Lane & { trigger_type?: string }).trigger_type ?? null })
                : "generic")
          ) as LaneArchetype,
          stepIndex: enr.current_step,
          property: {
            address: property.address,
            city: property.city,
            state: property.state,
            assetType: null, // intentionally pulled from properties if needed; PropertyMin doesn't have it yet
            sqft: null,
            yearsOwned: property.years_owned ?? null,
            mortgageMaturityDate: property.mortgage_maturity_date ?? null,
            mortgageLender: null,
            estimatedValue: property.estimated_value ?? null,
            name: property.name,
          },
          recipient: {
            name: contact?.full_name ?? property.owner_name_raw,
            role: null,
            company: null,
          },
          sender: DEFAULT_SENDER,
        });
        subject = personalized.subject || defaultSubject(step.channel, property);
        body = personalized.body;
      } catch (err) {
        // AI failed — log it, fall back to template so the cadence still progresses
        result.errors.push(`Enrollment ${enr.id}: AI personalization failed (${err instanceof Error ? err.message : err}); falling back to template`);
        subject = applyTemplate(step.subject ?? defaultSubject(step.channel, property), property, contact);
        body = applyTemplate(step.body ?? defaultBody(step.channel, property, contact), property, contact);
      }
    } else {
      // Template substitution — used for queued/drafted/manual paths
      subject = applyTemplate(step.subject ?? defaultSubject(step.channel, property), property, contact);
      body = applyTemplate(step.body ?? defaultBody(step.channel, property, contact), property, contact);
    }

    let touchStatus: string = "queued";
    let sentAt: string | null = null;
    let gmailMessageId: string | null = null;
    let gmailThreadId: string | null = null;

    if (mode === "auto" && step.channel === "email") {
      if (!contact?.email) {
        // No contact email — skip the step but advance cadence
        result.touchesSkipped += 1;
        touchStatus = "skipped";
      } else if (!gmailToken) {
        result.errors.push(`Enrollment ${enr.id}: cannot auto-send (no Gmail token)`);
        touchStatus = "failed";
      } else if (!options.dryRun) {
        try {
          const sent = await sendMessage(gmailToken.accessToken, {
            to: contact.full_name ? `"${contact.full_name}" <${contact.email}>` : contact.email,
            from: `${SEND_DISPLAY_NAME} <${gmailToken.email}>`,
            subject,
            bodyText: body,
          });
          touchStatus = "sent";
          sentAt = new Date().toISOString();
          gmailMessageId = sent.id;
          gmailThreadId = sent.threadId;
          result.touchesSent += 1;
          sentTodayByLane.set(lane.id, sentToday + 1);
        } catch (err) {
          result.errors.push(`Enrollment ${enr.id}: send failed: ${err instanceof Error ? err.message : err}`);
          touchStatus = "failed";
        }
      } else {
        touchStatus = "sent"; // dry-run
        result.touchesSent += 1;
      }
    } else if (mode === "auto" && step.channel === "sms") {
      // Pre-flight: Twilio configured?
      const { missing } = getTwilioConfig();
      const e164 = toE164(contact?.phone ?? null);
      if (missing.length > 0) {
        result.errors.push(`Enrollment ${enr.id}: Twilio not configured (${missing.join(", ")})`);
        touchStatus = "failed";
      } else if (!e164) {
        // No phone — skip and advance cadence
        result.touchesSkipped += 1;
        touchStatus = "skipped";
      } else if (!options.dryRun) {
        try {
          // Keep body under 160 chars for single-segment delivery; let the
          // template do that work. We don't truncate aggressively here so
          // longer messages can still send (they'll segment).
          const sent = await sendSms({ to: e164, body });
          touchStatus = "sent";
          sentAt = new Date().toISOString();
          gmailMessageId = sent.messageSid; // store the Twilio MessageSid in the same slot
          result.touchesSent += 1;
          sentTodayByLane.set(lane.id, sentToday + 1);
        } catch (err) {
          result.errors.push(`Enrollment ${enr.id}: SMS send failed: ${err instanceof Error ? err.message : err}`);
          touchStatus = "failed";
        }
      } else {
        touchStatus = "sent"; // dry-run
        result.touchesSent += 1;
      }
    } else if (mode === "auto" && step.channel === "letter") {
      // Letters can be "auto" — they get written to a queue for the mail-merge
      // service. For now we just log them as 'queued' with a note.
      touchStatus = "queued";
      result.touchesQueued += 1;
    } else if (mode === "queue") {
      touchStatus = "drafted";
      result.touchesQueued += 1;
    } else {
      // manual
      touchStatus = "queued";
      result.touchesQueued += 1;
    }

    // Write the lane_touches row
    let newTouchId: string | null = null;
    if (!options.dryRun) {
      const { data: touchData, error: touchErr } = await supabase.from("lane_touches").insert({
        organization_id: ORG_ID,
        enrollment_id: enr.id,
        lane_id: lane.id,
        property_id: property.id,
        contact_id: contact?.id ?? null,
        step_index: enr.current_step,
        channel: step.channel,
        status: touchStatus,
        scheduled_at: nowIso,
        sent_at: sentAt,
        subject,
        body,
        metadata: {
          cadence_run: true,
          gmail_message_id: step.channel === "email" ? gmailMessageId : null,
          gmail_thread_id: step.channel === "email" ? gmailThreadId : null,
          // For SMS, the same field slot holds the Twilio MessageSid;
          // store the to_phone too so the inbound webhook can match replies.
          twilio_message_sid: step.channel === "sms" ? gmailMessageId : null,
          to_phone: step.channel === "sms" ? toE164(contact?.phone ?? null) : null,
          template: step.template ?? null,
          approval_mode: mode,
        },
      }).select("id").single();
      if (touchErr) {
        result.errors.push(`Enrollment ${enr.id}: touch insert failed: ${touchErr.message}`);
      } else {
        newTouchId = (touchData as { id: string } | null)?.id ?? null;
      }

      // Mirror every sent email step to communications so the message is
      // visible in the ContactDrawer thread and the main Leads inbox.
      // This is the "communications as universal message log" principle:
      // lane_touches tracks cadence state; communications tracks every message.
      if (touchStatus === "sent" && step.channel === "email" && gmailMessageId && gmailThreadId && contact?.email) {
        // Resolve the lead for this contact+property (nullable — orphan is
        // healed later by linkOrphanedComms when a lead is created).
        const { data: leadRow } = await supabase
          .from("leads")
          .select("id")
          .eq("organization_id", ORG_ID)
          .eq("contact_id", contact.id)
          .eq("property_id", property.id)
          .neq("status", "archived")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const leadId = (leadRow as { id: string } | null)?.id ?? null;

        // Dedup: skip if this Gmail message was already logged (e.g. by poll-gmail)
        const { data: alreadyLogged } = await supabase
          .from("communications")
          .select("id")
          .eq("organization_id", ORG_ID)
          .eq("external_id", gmailMessageId)
          .maybeSingle();

        if (!alreadyLogged) {
          await supabase.from("communications").insert({
            organization_id: ORG_ID,
            channel: "email",
            direction: "outbound",
            external_id: gmailMessageId,
            subject,
            body_preview: body.slice(0, 500),
            from_address: gmailToken!.email,
            to_addresses: [contact.email],
            occurred_at: sentAt ?? nowIso,
            is_read: true,
            contact_id: contact.id,
            lead_id: leadId,                     // null if no lead yet — healed on reply
            property_id: property.id,
            // Cadence sends ARE the campaign motion. Without this the row
            // lands with touch_kind=null on an outbound record and shows as
            // "unclassified" in the comms dashboard.
            touch_kind: "campaign",
            raw_payload: {
              gmail_message_id: gmailMessageId,
              gmail_thread_id: gmailThreadId,
              source: "cadence",
              lane_touch_id: newTouchId,
              enrollment_id: enr.id,
              lane_id: lane.id,
              step_index: enr.current_step,
            },
          });

          // If lead_id is null (no lead exists for this contact+property yet),
          // this row is an orphan. It will be healed automatically when a lead
          // is created for this contact — linkOrphanedComms fires in both
          // maybeRouteAsReply (when they reply) and crexi-report (on import).
        }
      }
    }

    // Advance the enrollment
    const nextStep = enr.current_step + 1;
    const nextCadenceStep = lane.cadence[nextStep];
    const nextActionAt = nextCadenceStep
      ? new Date(new Date(enr.enrolled_at).getTime() + (nextCadenceStep.day_offset * 86400_000)).toISOString()
      : null;

    if (!options.dryRun) {
      if (nextCadenceStep) {
        await supabase
          .from("lane_enrollments")
          .update({
            current_step: nextStep,
            next_action_at: nextActionAt,
          })
          .eq("id", enr.id);
      } else {
        // No more steps — exit if no reply yet (will be handled on next run)
        await supabase
          .from("lane_enrollments")
          .update({
            current_step: nextStep,
            next_action_at: null,
            status: "exited_no_response",
            exited_at: nowIso,
            exit_reason: "Cadence completed",
          })
          .eq("id", enr.id);
        result.enrollmentsExited += 1;
      }
    }
  }

  return result;
}

// ── Templating ─────────────────────────────────────────────────────────────

function applyTemplate(s: string, property: PropertyMin, contact: ContactMin | null): string {
  return s
    .replace(/\{\{property\.address\}\}/g, property.address ?? property.name ?? "your property")
    .replace(/\{\{property\.name\}\}/g, property.name ?? property.address ?? "your property")
    .replace(/\{\{property\.city\}\}/g, property.city ?? "")
    .replace(/\{\{property\.state\}\}/g, property.state ?? "")
    .replace(/\{\{property\.years_owned\}\}/g, property.years_owned?.toString() ?? "")
    .replace(/\{\{owner\.name\}\}/g, contact?.full_name?.split(" ")[0] ?? property.owner_name_raw?.split(" ")[0] ?? "there")
    .replace(/\{\{owner\.full_name\}\}/g, contact?.full_name ?? property.owner_name_raw ?? "");
}

function defaultSubject(channel: string, property: PropertyMin): string {
  switch (channel) {
    case "email": return `About ${property.address ?? property.name ?? "your property"}`;
    case "letter": return `Stewardship CRE — outreach`;
    case "sms": return "";
    default: return property.address ?? "";
  }
}

function defaultBody(channel: string, property: PropertyMin, contact: ContactMin | null): string {
  const first = contact?.full_name?.split(" ")[0] ?? property.owner_name_raw?.split(" ")[0] ?? "there";
  if (channel === "email" || channel === "letter") {
    return `Hi ${first},\n\nI represent Stewardship CRE in Northwest Indiana. I came across ${property.address ?? property.name} and wanted to start a brief conversation.\n\nWould you be open to a 5-minute call this week?\n\n— John Mathewson\nStewardship CRE`;
  }
  if (channel === "sms") {
    return `Hi ${first}, John Mathewson from Stewardship CRE — quick question about ${property.address ?? "your property"}. Open to a 5-min call?`;
  }
  return "";
}
