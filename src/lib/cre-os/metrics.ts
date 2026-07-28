/**
 * metrics.ts — THE single source of truth for every headline number in CRE OS.
 *
 * Why this file exists (audit, 2026-07-28): the same metric was computed
 * differently on every screen — "hot leads" was 18 on Home, 9 in Inbox, 17 on
 * the Properties rail, and "none yet" on Listings, all in the same minute.
 * Active listings was 6, 7, or 13 depending on the page. Numbers that
 * disagree teach the user to trust none of them.
 *
 * THE RULE: no page, rail, or brief computes its own count of anything
 * defined here. Import from this file. If a definition is wrong, fix it HERE
 * so every surface changes together.
 *
 * Canonical definitions:
 *  - HOT LEAD: leads.urgency='hot' AND status NOT IN (archived, spam, sent).
 *    A lead you already answered is not "hot", it's handled.
 *  - UNANSWERED: an inbound communication from a human (email/sms/phone,
 *    direction=inbound, not an automated/system source) whose contact has no
 *    outbound reply from us at a later timestamp. THE one workflow number.
 *  - ACTIVE LISTING: properties.status IN ('listed','for_lease','under_contract')
 *    — matches the marketing site's PUBLIC_LISTING_STATUSES allow-list logic.
 *    Reports, Home, and Listings all previously used different sets.
 *  - PIPELINE STAGES: read from deal_stages, displayed with STAGE_ORDER below.
 *    The Pipeline board and Reports rollup must render the same list.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export const ACTIVE_LISTING_STATUSES = ["listed", "for_lease", "under_contract"] as const;

/** One agreed stage vocabulary. If the DB grows a new stage, add it here —
 *  screens render THIS order, and flag unknown stages loudly instead of
 *  silently inventing their own ladder. */
export const STAGE_ORDER = ["Lead", "Prospecting", "Qualifying", "BOV", "Active Listing", "Under Contract", "Due Diligence", "Closed"] as const;

export interface HeadlineMetrics {
  hotLeads: number;
  unanswered: number;
  activeListings: number;
  newLeadsToday: number;
  draftsReady: number;
}

export async function loadHeadlineMetrics(): Promise<HeadlineMetrics> {
  const sb = createServerSupabase();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [hot, listings, today, drafts, unanswered] = await Promise.all([
    sb.from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .eq("urgency", "hot")
      .not("status", "in", '("archived","spam","sent")'),
    sb.from("properties")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .in("status", [...ACTIVE_LISTING_STATUSES]),
    sb.from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .gte("created_at", todayStart.toISOString()),
    sb.from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .not("draft_reply", "is", null)
      .not("status", "in", '("archived","spam","sent")'),
    countUnanswered(),
  ]);

  return {
    hotLeads: hot.count ?? 0,
    activeListings: listings.count ?? 0,
    newLeadsToday: today.count ?? 0,
    draftsReady: drafts.count ?? 0,
    unanswered,
  };
}

/**
 * UNANSWERED — the workflow number. Inbound human messages (excludes
 * automated sources: crexi engagement mirrors, internal briefs) where our
 * latest outbound to that contact/lead is older than the inbound.
 *
 * Implementation note: computed per-lead (cheap at this scale). A lead is
 * unanswered when its most recent communications row is direction=inbound
 * on a human channel.
 */
export async function countUnanswered(): Promise<number> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("communications")
    .select("lead_id, direction, channel, occurred_at, raw_payload")
    .eq("organization_id", ORG_ID)
    .not("lead_id", "is", null)
    .order("occurred_at", { ascending: false })
    .limit(2000);

  const latestByLead = new Map<string, { direction: string; channel: string; source: string; answeredCall: boolean }>();
  for (const row of (data ?? []) as Array<{ lead_id: string; direction: string; channel: string; raw_payload: Record<string, unknown> | null }>) {
    if (!latestByLead.has(row.lead_id)) {
      const payload = row.raw_payload as Record<string, unknown> | null;
      latestByLead.set(row.lead_id, {
        direction: row.direction,
        channel: row.channel,
        source: String(payload?.source ?? ""),
        // A phone call John picked up is inbound in the log but already
        // handled — the conversation happened live.
        answeredCall: row.channel === "phone" && payload?.status === "answered",
      });
    }
  }

  let n = 0;
  for (const last of Array.from(latestByLead.values())) {
    const humanChannel = ["email", "sms", "phone", "website"].includes(last.channel);
    const automated = ["crexi_report", "internal", "steward"].includes(last.source);
    if (last.direction === "inbound" && humanChannel && !automated && !last.answeredCall) n += 1;
  }
  return n;
}
