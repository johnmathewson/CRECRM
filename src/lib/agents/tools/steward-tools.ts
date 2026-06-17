/**
 * Tools the Steward agent calls when assembling the morning brief.
 *
 * Each tool is a small typed Supabase query plus the schema definition
 * the model needs to discover and invoke it. Tools are READ-ONLY — the
 * brief is a read-and-reason exercise, not a mutate-the-DB one. If you
 * need a write tool later (mark a deal as touched, snooze a lead),
 * keep it in a separate registry so the read/write split is obvious
 * in callers.
 *
 * Tool inputs are minimal — most take a single threshold (days/hours)
 * or no params at all. Outputs are JSON-stringifiable, designed for
 * the model to reason over directly.
 */

import { createClient } from "@supabase/supabase-js";
import type { Tool } from "../run-agent";

// Hardcoded to the Stewardship org — same convention used everywhere
// else in the app. If/when we go multi-tenant this becomes a function
// arg threaded through runAgent.
const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function client(): any {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// ─── getHotLeadsQueued ──────────────────────────────────────────────────
// Leads where the auto-ack email has been sent but the broker has not
// yet sent a personal follow-up. Includes contact info + linked property
// so the agent can render a tap-to-text-ready row in the brief.

export const getHotLeadsQueued: Tool = {
  definition: {
    name: "get_hot_leads_queued",
    description:
      "Returns leads that have been auto-acknowledged via email but have NOT yet received a personal follow-up from the broker. " +
      "These are the 'second touch' candidates. Each row includes contact name, phone, email, company, the property they inquired on, " +
      "intent, urgency, qualifier_summary, source, and how long ago the inquiry came in. Call this once per brief.",
    input_schema: {
      type: "object",
      properties: {
        max: {
          type: "number",
          description: "Maximum rows to return. Default 25. Cap is the playbook decision, not the tool's.",
        },
      },
      required: [],
    },
  },
  handler: async (input: { max?: number }) => {
    const max = input.max ?? 25;
    const sb = client();
    const { data, error } = await sb
      .from("leads")
      .select(
        `id, sender_name, sender_email, sender_phone, source, status, intent, urgency,
         qualifier_summary, property_label, created_at, auto_ack_sent_at, contact_id,
         property:properties!leads_property_id_fkey(id, name, address, city, state, asking_price),
         contact:contacts!leads_contact_id_fkey(id, full_name, phone, email, company_id)`
      )
      .eq("organization_id", ORG_ID)
      .in("status", ["new", "contacted", "qualified"])
      .not("auto_ack_sent_at", "is", null)
      .is("final_sent_at", null)
      .order("created_at", { ascending: false })
      .limit(max);
    if (error) throw new Error(`get_hot_leads_queued: ${error.message}`);
    return { count: data?.length ?? 0, leads: data ?? [] };
  },
};

// ─── getStaleDeals ──────────────────────────────────────────────────────
// Open deals where no recent activity is recorded. "Recent" defaults to
// 7 days per the playbook. Uses deals.updated_at as the freshness signal
// for MVP — a richer "last touch across activities + communications"
// derivation can land later.

export const getStaleDeals: Tool = {
  definition: {
    name: "get_stale_deals",
    description:
      "Returns open deals (not closed, not dead) where no update has been recorded in the last N days. Each row includes deal name, " +
      "deal type, price, expected close, probability, contact, and the linked property. Use the days_quiet field to prioritize.",
    input_schema: {
      type: "object",
      properties: {
        days_cutoff: {
          type: "number",
          description: "How many days quiet before a deal is considered stale. Default 7.",
        },
      },
      required: [],
    },
  },
  handler: async (input: { days_cutoff?: number }) => {
    const daysCutoff = input.days_cutoff ?? 7;
    const cutoffIso = new Date(Date.now() - daysCutoff * 86_400_000).toISOString();
    const sb = client();
    const { data, error } = await sb
      .from("deals")
      .select(
        `id, deal_name, deal_type, price, commission_pct, estimated_commission, probability_pct,
         weighted_commission, expected_close, updated_at, notes,
         property:properties!deals_property_id_fkey(id, name, address, city, state),
         contact:contacts!deals_client_contact_id_fkey(id, full_name, phone, email)`
      )
      .eq("organization_id", ORG_ID)
      .or("is_closed.is.null,is_closed.eq.false")
      .or("is_dead.is.null,is_dead.eq.false")
      .lt("updated_at", cutoffIso)
      .order("updated_at", { ascending: true });
    if (error) throw new Error(`get_stale_deals: ${error.message}`);
    const now = Date.now();
    const enriched = (data ?? []).map((d: any) => ({
      ...d,
      days_quiet: Math.floor((now - new Date(d.updated_at).getTime()) / 86_400_000),
    }));
    return { count: enriched.length, days_cutoff: daysCutoff, deals: enriched };
  },
};

// ─── getActiveProperties ────────────────────────────────────────────────
// Every property John is actively representing — listing OR buyer-rep.
// Per playbook, ALL active listings come back regardless of
// days_on_market; CRE listings can run a year+. The agent decides what
// to flag. Filtered to NOT dead and not closed; otherwise inclusive.

export const getActiveProperties: Tool = {
  definition: {
    name: "get_active_properties",
    description:
      "Returns all properties John is actively representing as a listing or buyer-rep. Includes asking price, days_on_market, " +
      "asset type, address, CREXi listing id (if any), and recent inquiry counts. Per playbook, NO days_on_market filter — old " +
      "listings stay in scope.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    const sb = client();
    const { data, error } = await sb
      .from("properties")
      .select(
        `id, name, address, city, state, asset_type, sub_type, asking_price, sqft, days_on_market,
         pipeline_stage, your_role, crexi_listing_id, loopnet_listing_id, is_dead, dead_reason,
         occupancy_pct, percent_leased, headline, notes, marketing_notes, expected_close, probability_pct,
         created_at, updated_at`
      )
      .eq("organization_id", ORG_ID)
      .or("is_dead.is.null,is_dead.eq.false")
      .not("crexi_listing_id", "is", null)
      .order("days_on_market", { ascending: false, nullsFirst: false });
    if (error) throw new Error(`get_active_properties: ${error.message}`);
    return { count: data?.length ?? 0, properties: data ?? [] };
  },
};

// ─── getUnrepliedInbound ────────────────────────────────────────────────
// Inbound communications received in the last N hours where John has
// not yet sent a reply. MVP: surface inbound with is_read=false from
// the last 24h. (A more correct version would look for outbound to
// the same contact_id after the inbound timestamp; that's harder to
// express in one Supabase query and we can sharpen later.)

export const getUnrepliedInbound: Tool = {
  definition: {
    name: "get_unreplied_inbound",
    description:
      "Returns inbound emails/SMS received in the last N hours that have not been marked read. Includes sender, subject, " +
      "body preview, and links to contact/deal/property where known. Excludes CREXi auto-emails (those are surfaced separately).",
    input_schema: {
      type: "object",
      properties: {
        hours_cutoff: {
          type: "number",
          description: "Lookback window in hours. Default 24.",
        },
      },
      required: [],
    },
  },
  handler: async (input: { hours_cutoff?: number }) => {
    const hours = input.hours_cutoff ?? 24;
    const cutoffIso = new Date(Date.now() - hours * 3_600_000).toISOString();
    const sb = client();
    const { data, error } = await sb
      .from("communications")
      .select(
        `id, channel, subject, body_preview, from_address, to_addresses, occurred_at, is_read,
         contact_id, deal_id, property_id, lead_id`
      )
      .eq("organization_id", ORG_ID)
      .eq("direction", "inbound")
      .or("is_read.is.null,is_read.eq.false")
      .gte("occurred_at", cutoffIso)
      .not("from_address", "ilike", "%crexi.com%")
      .order("occurred_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`get_unreplied_inbound: ${error.message}`);
    return { count: data?.length ?? 0, hours_cutoff: hours, communications: data ?? [] };
  },
};

// ─── getNewCrexiInquiries ───────────────────────────────────────────────
// CREXi-sourced leads from the last N hours. Reads from the leads table
// (post-intake) rather than crexi_leads_state (pre-intake) because the
// leads table has the parsed sender + qualifier data the brief wants.

export const getNewCrexiInquiries: Tool = {
  definition: {
    name: "get_new_crexi_inquiries",
    description:
      "Returns leads sourced from CREXi within the last N hours. Includes sender name/email/phone, property inquired on, " +
      "intent, urgency, and the qualifier summary the intake agent extracted.",
    input_schema: {
      type: "object",
      properties: {
        hours_cutoff: {
          type: "number",
          description: "Lookback window in hours. Default 24.",
        },
      },
      required: [],
    },
  },
  handler: async (input: { hours_cutoff?: number }) => {
    const hours = input.hours_cutoff ?? 24;
    const cutoffIso = new Date(Date.now() - hours * 3_600_000).toISOString();
    const sb = client();
    const { data, error } = await sb
      .from("leads")
      .select(
        `id, sender_name, sender_email, sender_phone, source, status, intent, urgency,
         qualifier_summary, property_label, created_at, auto_ack_sent_at,
         property:properties!leads_property_id_fkey(id, name, address, city, state)`
      )
      .eq("organization_id", ORG_ID)
      .eq("source", "crexi")
      .gte("created_at", cutoffIso)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`get_new_crexi_inquiries: ${error.message}`);
    return { count: data?.length ?? 0, hours_cutoff: hours, inquiries: data ?? [] };
  },
};

// ─── getApproachingKeyDates ─────────────────────────────────────────────
// Deals whose expected_close falls within the next N days, plus any
// notes on contingencies. MVP: only expected_close. LOI/DD/financing
// dates can be added when those fields land in the schema.

export const getApproachingKeyDates: Tool = {
  definition: {
    name: "get_approaching_key_dates",
    description:
      "Returns deals with key dates (currently expected_close) within the next N days. These outrank everything else in the " +
      "brief per the playbook. Each row includes deal name, the date, days_remaining, deal type, price, and contact.",
    input_schema: {
      type: "object",
      properties: {
        days_cutoff: {
          type: "number",
          description: "Lookahead window in days. Default 7.",
        },
      },
      required: [],
    },
  },
  handler: async (input: { days_cutoff?: number }) => {
    const days = input.days_cutoff ?? 7;
    const todayIso = new Date().toISOString().slice(0, 10);
    const horizonIso = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const sb = client();
    const { data, error } = await sb
      .from("deals")
      .select(
        `id, deal_name, deal_type, price, expected_close, probability_pct, notes,
         property:properties!deals_property_id_fkey(id, name, address),
         contact:contacts!deals_client_contact_id_fkey(id, full_name, phone, email)`
      )
      .eq("organization_id", ORG_ID)
      .or("is_closed.is.null,is_closed.eq.false")
      .or("is_dead.is.null,is_dead.eq.false")
      .gte("expected_close", todayIso)
      .lte("expected_close", horizonIso)
      .order("expected_close", { ascending: true });
    if (error) throw new Error(`get_approaching_key_dates: ${error.message}`);
    const today = new Date(todayIso).getTime();
    const enriched = (data ?? []).map((d: any) => ({
      ...d,
      date_type: "expected_close",
      days_remaining: Math.round((new Date(d.expected_close).getTime() - today) / 86_400_000),
    }));
    return { count: enriched.length, days_cutoff: days, dates: enriched };
  },
};

// ─── getYesterdayBrief ──────────────────────────────────────────────────
// The previous daily brief, for "what changed" framing. Steward should
// mention material changes since yesterday's brief without re-running
// the same observations verbatim.

export const getYesterdayBrief: Tool = {
  definition: {
    name: "get_yesterday_brief",
    description:
      "Returns the previous daily brief (text only, not the full HTML render). Use this to avoid repeating observations and to " +
      "frame what's changed since yesterday. Returns null if no prior brief exists (first run, missed days, etc.).",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    const sb = client();
    const { data, error } = await sb
      .from("daily_briefings")
      .select("brief_date, content_text, reasoning")
      .eq("organization_id", ORG_ID)
      .eq("brief_type", "daily")
      .order("brief_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`get_yesterday_brief: ${error.message}`);
    return data ?? null;
  },
};

// ─── getBrokerVoiceProfile ──────────────────────────────────────────────
// Voice rules so Steward stays in John's tone. The playbook already
// constrains tone heavily, but the broker_voice_profile carries the
// always_do/never_do rules and banned phrases that have been learned
// from prior edits.

export const getBrokerVoiceProfile: Tool = {
  definition: {
    name: "get_broker_voice_profile",
    description:
      "Returns John's voice profile: brand_voice description, pet_phrases, banned_phrases, always_do rules, never_do rules. " +
      "Reflect these in the brief's tone. Call this once per brief.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    const sb = client();
    const { data, error } = await sb
      .from("broker_voice_profile")
      .select("brand_voice, pet_phrases, banned_phrases, always_do, never_do, sign_off_default, bio")
      .eq("organization_id", ORG_ID)
      .maybeSingle();
    if (error) throw new Error(`get_broker_voice_profile: ${error.message}`);
    return data ?? null;
  },
};

/** Convenience array of every Steward tool, in registry order. */
export const STEWARD_TOOLS: Tool[] = [
  getHotLeadsQueued,
  getStaleDeals,
  getActiveProperties,
  getUnrepliedInbound,
  getNewCrexiInquiries,
  getApproachingKeyDates,
  getYesterdayBrief,
  getBrokerVoiceProfile,
];
