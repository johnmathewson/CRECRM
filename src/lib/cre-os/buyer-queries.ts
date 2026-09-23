/**
 * CRE OS — Buyers data layer.
 *
 *   loadBuyerBoard() → one row per PERSON (not per lead) across every
 *   listing they've touched, ranked by buyer-intent score.
 *
 * Folds together: leads (intent=buy), crexi_leads_state (freshest CREXi
 * engagement), call_logs, contacts. No row cap — the inbox's 200-lead
 * window hides months of buyers; this view must not.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { castOne } from "./supabase-utils";
import { relativeTime } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export type BuyerRoleClass = "principal" | "buyer_rep" | "non_buyer" | "unknown" | "other";

export interface BuyerListing {
  id: string;
  name: string;
  slug: string | null;
  assetType: string | null;
  city: string | null;
  askingPrice: number | null;
  /** Strongest CREXi signal this person showed on this listing */
  topSignal: string | null;
}

export interface BuyerRow {
  /** Stable key — lower-cased email, else phone, else name */
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  roleClass: BuyerRoleClass;
  urgency: "hot" | "warm" | "cold" | null;
  score: number;
  /** Strongest signal across all listings — "Pending Offer", "Executed CA", … */
  topSignal: string | null;
  signalTier: number;
  listings: BuyerListing[];
  /** Distinct asset types touched, e.g. ["retail","hospitality"] */
  assetTypes: string[];
  priceMin: number | null;
  priceMax: number | null;
  totalVisits: number;
  lastActivityAt: string | null;
  lastActivityRelative: string;
  /** Any lead for this person has a sent reply */
  replied: boolean;
  lastCallAt: string | null;
  lastCallOutcome: string | null;
  callCount: number;
  /** Most recent lead — what the drawer / call panel open */
  leadId: string;
  contactId: string | null;
  warmth: string | null;
  /** Free-text criteria the buyer stated in a reply, if any was captured */
  statedCriteria: string | null;
}

export interface BuyerBoard {
  buyers: BuyerRow[];
  pools: Array<{ assetType: string; people: number; hot: number; caOrBetter: number }>;
  generatedAt: string;
}

const SIGNAL_TIER: Record<string, number> = {
  "Pending Offer": 5,
  "Executed CA": 4,
  "Opened OM": 4,
  "Requested Info": 4,
  "Saved Property": 3,
  "Follower": 3,
  "Opened Flyer": 2,
  "Visited Page": 1,
  "Visitor": 1,
};

function tierOf(signal: string | null | undefined): number {
  if (!signal) return 0;
  return SIGNAL_TIER[signal] ?? 1;
}

function classifyRole(role: string | null | undefined): BuyerRoleClass {
  if (!role) return "unknown";
  const r = role.toLowerCase();
  if (/principal|private investor|prospective investor|reit|developer|owner/.test(r)) return "principal";
  if (/buyer rep/.test(r)) return "buyer_rep";
  if (/listing rep|landlord rep|property manager|service provider|lender|appraiser|assessor|coordinator|tenant/.test(r)) return "non_buyer";
  return "other";
}

function extractField(body: string | null | undefined, field: string): string | null {
  if (!body) return null;
  const m = body.match(new RegExp(`"${field}":\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

function extractVisits(body: string | null | undefined): number {
  if (!body) return 0;
  const m = body.match(/"number_of_visits":\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// Buyers who typed their acquisition criteria into a reply. Cheap regex over
// the free-text replies; the AI drafter's structured extraction is the real
// home for this once it runs on replies.
function extractStatedCriteria(body: string | null | undefined): string | null {
  if (!body || body.trimStart().startsWith("{")) return null;
  const m = body.match(/(acquisition criteria|looking for|buy box|criteria)[:\s-]+([^.\n]{10,160})/i);
  return m ? m[2].trim() : null;
}

export async function loadBuyerBoard(): Promise<BuyerBoard> {
  const sb = createServerSupabase();

  const [{ data: leadRows }, { data: stateRows }] = await Promise.all([
    sb
      .from("leads")
      .select(
        `id, sender_name, sender_email, sender_phone, status, urgency, source,
         qualifier_summary, claude_extraction, contact_id, final_sent_at, created_at, raw_body,
         property:properties(id, name, slug, asset_type, city, asking_price, transaction_type)`,
      )
      .eq("organization_id", ORG_ID)
      .eq("intent", "buy")
      .not("status", "in", '("spam")')
      .order("created_at", { ascending: false }),
    sb
      .from("crexi_leads_state")
      .select("email, phone, name, company, role, level_of_interest, number_of_visits, last_activity_date, property_id")
      .eq("organization_id", ORG_ID),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leads = (leadRows ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const states = (stateRows ?? []) as any[];

  const leadIds = leads.map((l) => l.id);
  const contactIds = Array.from(new Set(leads.map((l) => l.contact_id).filter(Boolean)));

  const [{ data: callRows }, { data: contactRows }] = await Promise.all([
    leadIds.length
      ? sb.from("call_logs").select("lead_id, called_at, outcome").eq("organization_id", ORG_ID).in("lead_id", leadIds).order("called_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
    contactIds.length
      ? sb.from("contacts").select("id, warmth").in("id", contactIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const callByLead = new Map<string, { last: string; outcome: string; count: number }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of ((callRows ?? []) as any[])) {
    const prev = callByLead.get(c.lead_id);
    if (!prev) { callByLead.set(c.lead_id, { last: c.called_at, outcome: c.outcome, count: 1 }); continue; }
    const newer = new Date(c.called_at) > new Date(prev.last);
    callByLead.set(c.lead_id, { last: newer ? c.called_at : prev.last, outcome: newer ? c.outcome : prev.outcome, count: prev.count + 1 });
  }
  const warmthByContact = new Map<string, string | null>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const c of ((contactRows ?? []) as any[])) warmthByContact.set(c.id, c.warmth ?? null);

  // Property lookup so crexi_leads_state rows (which carry only property_id)
  // can contribute listings the leads table may not have.
  const propertyById = new Map<string, BuyerListing>();
  for (const l of leads) {
    const p = castOne<{ id: string; name: string; slug: string | null; asset_type: string | null; city: string | null; asking_price: number | null }>(l.property);
    if (p && !propertyById.has(p.id)) {
      propertyById.set(p.id, { id: p.id, name: p.name, slug: p.slug, assetType: p.asset_type, city: p.city, askingPrice: p.asking_price === null ? null : Number(p.asking_price), topSignal: null });
    }
  }

  type Acc = {
    key: string; name: string | null; email: string | null; phone: string | null;
    company: string | null; role: string | null; score: number; urgencyRank: number; urgency: BuyerRow["urgency"];
    signals: Map<string, string | null>; // propertyId → top signal
    visits: number; lastActivity: number; replied: boolean;
    lastCall: { last: string; outcome: string; count: number } | null;
    leadId: string; leadCreated: number; contactId: string | null; statedCriteria: string | null;
  };
  const people = new Map<string, Acc>();

  const keyFor = (email: string | null, phone: string | null, name: string | null) =>
    (email?.trim().toLowerCase()) || (phone?.replace(/\D/g, "") ? `tel:${phone!.replace(/\D/g, "")}` : null) || (name ? `name:${name.trim().toLowerCase()}` : null);

  const urgencyRank = (u: string | null) => (u === "hot" ? 3 : u === "warm" ? 2 : u === "cold" ? 1 : 0);

  const bump = (acc: Acc, propertyId: string | null, signal: string | null) => {
    if (!propertyId) return;
    const prev = acc.signals.get(propertyId) ?? null;
    if (tierOf(signal) >= tierOf(prev)) acc.signals.set(propertyId, signal);
  };

  for (const l of leads) {
    const key = keyFor(l.sender_email, l.sender_phone, l.sender_name);
    if (!key) continue;
    const ex = (l.claude_extraction ?? {}) as Record<string, unknown>;
    const p = castOne<{ id: string }>(l.property);
    const created = l.created_at ? new Date(l.created_at).getTime() : 0;
    let acc = people.get(key);
    if (!acc) {
      acc = {
        key, name: l.sender_name ?? null, email: l.sender_email ?? null, phone: l.sender_phone ?? null,
        company: null, role: null, score: 0, urgencyRank: 0, urgency: null,
        signals: new Map(), visits: 0, lastActivity: 0, replied: false, lastCall: null,
        leadId: l.id, leadCreated: created, contactId: l.contact_id ?? null, statedCriteria: null,
      };
      people.set(key, acc);
    }
    if (!acc.name && l.sender_name) acc.name = l.sender_name;
    if (!acc.email && l.sender_email) acc.email = l.sender_email;
    if (!acc.phone && l.sender_phone) acc.phone = l.sender_phone;
    if (!acc.contactId && l.contact_id) acc.contactId = l.contact_id;
    if (created > acc.leadCreated) { acc.leadCreated = created; acc.leadId = l.id; }

    const exScore = typeof ex.score === "number" ? ex.score : null;
    if (exScore !== null && exScore > acc.score) acc.score = exScore;
    if (typeof ex.company === "string" && ex.company && !/^(na|none|principal)$/i.test(ex.company)) acc.company = acc.company ?? ex.company;
    if (typeof ex.role === "string" && ex.role) acc.role = acc.role ?? ex.role;
    if (typeof ex.last_activity === "string") acc.lastActivity = Math.max(acc.lastActivity, new Date(ex.last_activity).getTime());
    if (typeof ex.total_visits === "number") acc.visits = Math.max(acc.visits, ex.total_visits);

    const ur = urgencyRank(l.urgency);
    if (ur > acc.urgencyRank) { acc.urgencyRank = ur; acc.urgency = l.urgency; }

    const sig = (typeof ex.top_signal === "string" ? ex.top_signal : null) ?? extractField(l.raw_body, "level_of_interest");
    bump(acc, p?.id ?? null, sig);
    acc.visits = Math.max(acc.visits, extractVisits(l.raw_body));
    acc.lastActivity = Math.max(acc.lastActivity, created);
    if (l.final_sent_at) acc.replied = true;
    acc.role = acc.role ?? extractField(l.raw_body, "industry_role");
    const co = extractField(l.raw_body, "company");
    if (co && !/^(na|none|principal)$/i.test(co)) acc.company = acc.company ?? co;
    acc.statedCriteria = acc.statedCriteria ?? extractStatedCriteria(l.raw_body);

    const call = callByLead.get(l.id);
    if (call && (!acc.lastCall || new Date(call.last) > new Date(acc.lastCall.last))) {
      acc.lastCall = { ...call, count: (acc.lastCall?.count ?? 0) + call.count };
    } else if (call && acc.lastCall) {
      acc.lastCall.count += call.count;
    }
  }

  // Fold in the live CREXi watcher state — freshest signal per person/listing.
  for (const s of states) {
    const key = keyFor(s.email, s.phone, s.name);
    if (!key) continue;
    const acc = people.get(key);
    if (!acc) continue; // Only enrich people who already have a buy lead
    bump(acc, s.property_id ?? null, s.level_of_interest ?? null);
    acc.visits = Math.max(acc.visits, Number(s.number_of_visits ?? 0));
    if (s.last_activity_date) acc.lastActivity = Math.max(acc.lastActivity, new Date(s.last_activity_date).getTime());
    acc.role = acc.role ?? s.role ?? null;
    if (s.company && !/^(na|none|principal)$/i.test(s.company)) acc.company = acc.company ?? s.company;
    if (s.property_id && !propertyById.has(s.property_id)) {
      propertyById.set(s.property_id, { id: s.property_id, name: "Listing", slug: null, assetType: null, city: null, askingPrice: null, topSignal: null });
    }
  }

  // Backfill names for state-only property rows in one query.
  const unnamed = Array.from(propertyById.values()).filter((p) => p.name === "Listing").map((p) => p.id);
  if (unnamed.length) {
    const { data: props } = await sb.from("properties").select("id, name, slug, asset_type, city, asking_price").in("id", unnamed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of ((props ?? []) as any[])) {
      propertyById.set(p.id, { id: p.id, name: p.name, slug: p.slug, assetType: p.asset_type, city: p.city, askingPrice: p.asking_price === null ? null : Number(p.asking_price), topSignal: null });
    }
  }

  const buyers: BuyerRow[] = [];
  for (const acc of Array.from(people.values())) {
    const listings: BuyerListing[] = [];
    let topSignal: string | null = null;
    for (const [pid, sig] of Array.from(acc.signals.entries())) {
      const p = propertyById.get(pid);
      if (!p) continue;
      listings.push({ ...p, topSignal: sig });
      if (tierOf(sig) > tierOf(topSignal)) topSignal = sig;
    }
    listings.sort((a, b) => tierOf(b.topSignal) - tierOf(a.topSignal));
    const assetTypes = Array.from(new Set(listings.map((l) => l.assetType).filter((x): x is string => !!x)));
    const prices = listings.map((l) => l.askingPrice).filter((x): x is number => x !== null);
    const roleClass = classifyRole(acc.role);

    // Score fallback for leads that predate the engagement scoring pass.
    let score = acc.score;
    if (!score) {
      score = tierOf(topSignal) * 10 + Math.max(0, listings.length - 1) * 8 + Math.min(acc.visits, 20)
        + (roleClass === "principal" ? 12 : roleClass === "buyer_rep" ? 6 : roleClass === "non_buyer" ? -15 : 2);
      if (acc.lastActivity && Date.now() - acc.lastActivity < 30 * 86_400_000) score += 10;
    }

    buyers.push({
      key: acc.key,
      name: acc.name?.trim() || acc.email || acc.phone || "Unknown",
      email: acc.email,
      phone: acc.phone,
      company: acc.company,
      role: acc.role,
      roleClass,
      urgency: acc.urgency,
      score: Math.round(score),
      topSignal,
      signalTier: tierOf(topSignal),
      listings,
      assetTypes,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceMax: prices.length ? Math.max(...prices) : null,
      totalVisits: acc.visits,
      lastActivityAt: acc.lastActivity ? new Date(acc.lastActivity).toISOString() : null,
      lastActivityRelative: acc.lastActivity ? relativeTime(new Date(acc.lastActivity).toISOString()) : "—",
      replied: acc.replied,
      lastCallAt: acc.lastCall?.last ?? null,
      lastCallOutcome: acc.lastCall?.outcome ?? null,
      callCount: acc.lastCall?.count ?? 0,
      leadId: acc.leadId,
      contactId: acc.contactId,
      warmth: acc.contactId ? warmthByContact.get(acc.contactId) ?? null : null,
      statedCriteria: acc.statedCriteria,
    });
  }

  // Brokers who signed CAs are a different lane from buyers — keep them
  // visible but never above an actual principal or buyer rep.
  buyers.sort((a, b) =>
    Number(a.roleClass === "non_buyer") - Number(b.roleClass === "non_buyer")
    || b.score - a.score
    || (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));

  const poolMap = new Map<string, { people: number; hot: number; caOrBetter: number }>();
  for (const b of buyers) {
    for (const t of b.assetTypes) {
      const p = poolMap.get(t) ?? { people: 0, hot: 0, caOrBetter: 0 };
      p.people += 1;
      if (b.urgency === "hot") p.hot += 1;
      if (b.signalTier >= 4) p.caOrBetter += 1;
      poolMap.set(t, p);
    }
  }
  const pools = Array.from(poolMap.entries())
    .map(([assetType, v]) => ({ assetType, ...v }))
    .sort((a, b) => b.people - a.people);

  return { buyers, pools, generatedAt: new Date().toISOString() };
}
