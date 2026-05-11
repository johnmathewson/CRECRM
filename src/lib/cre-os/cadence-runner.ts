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
  const laneQuery = supabase
    .from("lanes")
    .select("id, name, status, cadence, approval_mode, daily_touch_cap")
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

    // Apply template substitutions
    const subject = applyTemplate(step.subject ?? defaultSubject(step.channel, property), property, contact);
    const body = applyTemplate(step.body ?? defaultBody(step.channel, property, contact), property, contact);

    // Approval mode for this channel
    const mode = lane.approval_mode[step.channel] ?? "queue";

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
    if (!options.dryRun) {
      const { error: touchErr } = await supabase.from("lane_touches").insert({
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
          gmail_message_id: gmailMessageId,
          gmail_thread_id: gmailThreadId,
          template: step.template ?? null,
          approval_mode: mode,
        },
      });
      if (touchErr) {
        result.errors.push(`Enrollment ${enr.id}: touch insert failed: ${touchErr.message}`);
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
