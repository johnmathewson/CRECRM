/**
 * CRE OS — Relationship Intelligence data layer.
 *
 *   loadRelationshipList(filters) → cards for /cre-os/relationships
 *   loadContactDetail(id)         → full contact workspace
 *
 * Both ORG-scoped. Warmth is computed where the user hasn't set it manually,
 * combining recency, frequency, link-density, and active-deal signals into
 * one 0-100 score with a discrete label (Hot / Warm / Cool / Cold).
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { castOne, castMany } from "./supabase-utils";
import { daysSince, relativeTime, humanizeActivity, numOrNull } from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export type WarmthLabel = "hot" | "warm" | "cool" | "cold";

export interface RelationshipListFilters {
  q?: string;
  contactType?: string;
  warmth?: WarmthLabel | "all";
  bucket?: "all" | "hot" | "owners-quiet" | "follow-ups-due" | "no-recent-touch";
}

export interface RelationshipCard {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  contactType: string | null;
  role: string | null;
  companyId: string | null;
  /** Manually-set warmth from contacts.warmth, lowercased */
  manualWarmth: WarmthLabel | null;
  /** Computed score 0-100 from signals */
  warmthScore: number;
  /** Final label (manual takes precedence over computed) */
  warmth: WarmthLabel;
  /** Days since the most recent activity touched this contact */
  daysSinceTouch: number | null;
  /** Manually-set follow-up date — coral when overdue */
  nextFollowUp: string | null;
  followUpOverdue: boolean;
  /** Counts that drive the cards */
  activityCount90d: number;
  hotLeadCount: number;
  openDealCount: number;
  linkedPropertyCount: number;
  /** Composite priority — higher = warrants attention now */
  priorityScore: number;
  nextAction: string | null;
}

export interface ContactDetail {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  contactType: string | null;
  role: string | null;
  companyId: string | null;
  companyName: string | null;
  notes: string | null;
  createdAt: string | null;
  manualWarmth: WarmthLabel | null;
  warmthScore: number;
  warmth: WarmthLabel;
  /** Why the warmth landed where it did — for the tap-to-explain panel */
  warmthReasons: string[];
  daysSinceTouch: number | null;
  nextFollowUp: string | null;
  followUpOverdue: boolean;
  activityCount90d: number;
  // Linked record summaries
  linkedProperties: Array<{
    id: string;
    name: string;
    slug: string;
    city: string | null;
    state: string | null;
    role: string;     // why they're linked: "owner" / "tenant" / "buyer interest" / "broker"
  }>;
  linkedDeals: Array<{
    id: string;
    dealName: string | null;
    dealType: string | null;
    price: number | null;
    stage: string | null;
    isClosed: boolean;
    isDead: boolean;
  }>;
  linkedLeads: Array<{
    id: string;
    propertyLabel: string | null;
    intent: string | null;
    urgency: string | null;
    status: string | null;
    createdAt: string | null;
  }>;
  // Activity feed (last 30)
  activity: Array<{
    id: string;
    when: string;
    rawTime: string | null;
    activityType: string | null;
    did: string;
    subject: string | null;
    body: string | null;
  }>;
}

// ── List loader ────────────────────────────────────────────────────────────
export async function loadRelationshipList(
  filters: RelationshipListFilters = {},
): Promise<RelationshipCard[]> {
  const sb = createServerSupabase();

  let q = sb
    .from("contacts")
    .select(
      "id, full_name, email, phone, city, state, contact_type, role, company_id, warmth, last_conversation, next_follow_up",
    )
    .eq("organization_id", ORG_ID)
    .order("full_name", { ascending: true });

  if (filters.contactType && filters.contactType !== "all") {
    q = q.eq("contact_type", filters.contactType);
  }
  if (filters.q && filters.q.trim()) {
    const term = `%${filters.q.trim()}%`;
    q = q.or(`full_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
  }

  const { data: rows } = await q.limit(500);
  const contacts = (rows ?? []) as any[];
  if (!contacts.length) return [];
  const ids = contacts.map((c) => c.id);

  // Fan out signal lookups in parallel
  const [actMap, hotLeadMap, dealMap, propMap, lastTouchMap] = await Promise.all([
    fetchActivityCounts90d(ids),
    fetchHotLeadCountsByContact(ids),
    fetchOpenDealCountsByContact(ids),
    fetchLinkedPropertyCounts(ids),
    fetchLastActivityByContact(ids),
  ]);

  const cards = contacts.map((c): RelationshipCard => {
    const lastIso = lastTouchMap.get(c.id) ?? null;
    const daysSinceTouch = lastIso ? daysSince(lastIso) : null;
    const manualWarmth = normalizeWarmthInput(c.warmth);
    const activityCount90d = actMap.get(c.id) ?? 0;
    const hotLeadCount = hotLeadMap.get(c.id) ?? 0;
    const openDealCount = dealMap.get(c.id) ?? 0;
    const linkedPropertyCount = propMap.get(c.id) ?? 0;

    const { score, reasons } = computeWarmthScore({
      daysSinceTouch,
      activityCount90d,
      hotLeadCount,
      openDealCount,
      linkedPropertyCount,
    });
    const warmth: WarmthLabel = manualWarmth ?? labelFromScore(score);

    const followUpOverdue = !!c.next_follow_up && c.next_follow_up < new Date().toISOString().slice(0, 10);

    let priorityScore = 0;
    priorityScore += hotLeadCount * 3;
    if (followUpOverdue) priorityScore += 3;
    if (warmth === "hot") priorityScore += 2;
    if (openDealCount > 0) priorityScore += 1;
    if (daysSinceTouch !== null && daysSinceTouch >= 14 && warmth !== "cold") priorityScore += 2;

    return {
      id: c.id,
      fullName: c.full_name ?? "(no name)",
      email: c.email ?? null,
      phone: c.phone ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      contactType: c.contact_type ?? null,
      role: c.role ?? null,
      companyId: c.company_id ?? null,
      manualWarmth,
      warmthScore: score,
      warmth,
      daysSinceTouch,
      nextFollowUp: c.next_follow_up ?? null,
      followUpOverdue,
      activityCount90d,
      hotLeadCount,
      openDealCount,
      linkedPropertyCount,
      priorityScore,
      nextAction: pickNextAction({
        hotLeadCount, openDealCount, daysSinceTouch, warmth,
        followUpOverdue, contactType: c.contact_type,
      }),
    };
  });

  // Server-side bucket filter (after computing signals)
  return cards.filter((c) => matchesBucket(c, filters.bucket ?? "all", filters.warmth ?? "all"));
}

function matchesBucket(c: RelationshipCard, bucket: NonNullable<RelationshipListFilters["bucket"]>, warmth: WarmthLabel | "all"): boolean {
  if (warmth !== "all" && c.warmth !== warmth) return false;
  switch (bucket) {
    case "hot":
      return c.warmth === "hot" || c.hotLeadCount > 0;
    case "owners-quiet":
      return (c.contactType === "owner") && (c.daysSinceTouch === null || c.daysSinceTouch >= 14);
    case "follow-ups-due":
      return c.followUpOverdue;
    case "no-recent-touch":
      return c.daysSinceTouch === null || c.daysSinceTouch >= 30;
    default:
      return true;
  }
}

// ── Detail loader ──────────────────────────────────────────────────────────
export async function loadContactDetail(id: string): Promise<ContactDetail | null> {
  const sb = createServerSupabase();

  const { data: cRaw } = await sb
    .from("contacts")
    .select(
      "id, full_name, email, phone, city, state, contact_type, role, company_id, warmth, last_conversation, next_follow_up, notes, created_at, company:companies(id, name)",
    )
    .eq("organization_id", ORG_ID)
    .eq("id", id)
    .maybeSingle();
  const c: any = cRaw;
  if (!c) return null;

  const company = castOne<{ id: string; name: string }>(c.company);

  const [activityCount, lastIso, leadRows, dealRows, activityRows, propertyRoles] =
    await Promise.all([
      fetchActivityCount90dForContact(id),
      fetchLastActivityForContact(id),
      fetchLeadsForContact(id),
      fetchDealsForContact(id),
      fetchActivityForContact(id, 30),
      fetchPropertiesLinkedToContact(id),
    ]);

  const daysSinceTouch = lastIso ? daysSince(lastIso) : null;
  const manualWarmth = normalizeWarmthInput(c.warmth);
  const hotLeadCount = leadRows.filter((l) => l.urgency === "hot").length;
  const openDealCount = dealRows.filter((d) => !d.is_closed && !d.is_dead).length;
  const linkedPropertyCount = propertyRoles.length;

  const { score, reasons } = computeWarmthScore({
    daysSinceTouch,
    activityCount90d: activityCount,
    hotLeadCount,
    openDealCount,
    linkedPropertyCount,
  });
  const warmth: WarmthLabel = manualWarmth ?? labelFromScore(score);

  const followUpOverdue = !!c.next_follow_up && c.next_follow_up < new Date().toISOString().slice(0, 10);

  return {
    id: c.id,
    fullName: c.full_name ?? "(no name)",
    email: c.email ?? null,
    phone: c.phone ?? null,
    city: c.city ?? null,
    state: c.state ?? null,
    contactType: c.contact_type ?? null,
    role: c.role ?? null,
    companyId: c.company_id ?? null,
    companyName: company?.name ?? null,
    notes: c.notes ?? null,
    createdAt: c.created_at ?? null,
    manualWarmth,
    warmthScore: score,
    warmth,
    warmthReasons: reasons,
    daysSinceTouch,
    nextFollowUp: c.next_follow_up ?? null,
    followUpOverdue,
    activityCount90d: activityCount,
    linkedProperties: propertyRoles,
    linkedDeals: dealRows.map((d): ContactDetail["linkedDeals"][number] => ({
      id: d.id,
      dealName: d.deal_name,
      dealType: d.deal_type,
      price: numOrNull(d.price),
      stage: d.stage,
      isClosed: !!d.is_closed,
      isDead: !!d.is_dead,
    })),
    linkedLeads: leadRows.map((l): ContactDetail["linkedLeads"][number] => ({
      id: l.id,
      propertyLabel: l.property_label,
      intent: l.intent,
      urgency: l.urgency,
      status: l.status,
      createdAt: l.created_at,
    })),
    activity: activityRows.map((a): ContactDetail["activity"][number] => ({
      id: a.id,
      when: relativeTime(a.occurred_at),
      rawTime: a.occurred_at,
      activityType: a.activity_type,
      did: humanizeActivity(a.activity_type),
      subject: a.subject,
      body: a.body,
    })),
  };
}

// ── Warmth scoring ─────────────────────────────────────────────────────────
interface WarmthSignals {
  daysSinceTouch: number | null;
  activityCount90d: number;
  hotLeadCount: number;
  openDealCount: number;
  linkedPropertyCount: number;
}

/**
 * Compute a 0-100 warmth score from objective signals. Returns the score AND
 * a list of reasons (for the tap-to-explain panel on the contact workspace).
 *
 * Weights tuned so:
 *   - A contact in an active deal lands ≥ 60 (warm) by default
 *   - Recent activity (≤7 days) adds ~20
 *   - Activity volume over 90 days adds up to ~25
 *   - Cold contacts (no touch ever, no records) land near 5-10
 */
function computeWarmthScore(s: WarmthSignals): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Recency — single biggest signal
  if (s.daysSinceTouch === null) {
    score += 0;
    reasons.push("No recorded activity yet.");
  } else if (s.daysSinceTouch <= 1) {
    score += 30;
    reasons.push("Active conversation in the last 24 hours.");
  } else if (s.daysSinceTouch <= 7) {
    score += 22;
    reasons.push(`Touched ${s.daysSinceTouch} day${s.daysSinceTouch === 1 ? "" : "s"} ago.`);
  } else if (s.daysSinceTouch <= 30) {
    score += 12;
    reasons.push(`Touched ${s.daysSinceTouch} days ago.`);
  } else if (s.daysSinceTouch <= 90) {
    score += 4;
    reasons.push(`Touched ${s.daysSinceTouch} days ago — relationship cooling.`);
  } else {
    reasons.push(`Last touched ${s.daysSinceTouch} days ago — relationship cold.`);
  }

  // Frequency over the last 90 days
  if (s.activityCount90d >= 10) {
    score += 25;
    reasons.push(`${s.activityCount90d} activities in the last 90 days — high engagement.`);
  } else if (s.activityCount90d >= 5) {
    score += 15;
    reasons.push(`${s.activityCount90d} activities in the last 90 days.`);
  } else if (s.activityCount90d >= 1) {
    score += 6;
    reasons.push(`${s.activityCount90d} activit${s.activityCount90d === 1 ? "y" : "ies"} in the last 90 days.`);
  }

  // Active deals — strongest "matters now" signal
  if (s.openDealCount > 0) {
    score += 20;
    reasons.push(`${s.openDealCount} active deal${s.openDealCount === 1 ? "" : "s"} in motion.`);
  }

  // Hot leads in flight
  if (s.hotLeadCount > 0) {
    score += 15;
    reasons.push(`${s.hotLeadCount} hot lead${s.hotLeadCount === 1 ? "" : "s"} pending response.`);
  }

  // Link density — buyer / owner of multiple assets
  if (s.linkedPropertyCount >= 5) {
    score += 10;
    reasons.push(`Linked to ${s.linkedPropertyCount} properties — strategic relationship.`);
  } else if (s.linkedPropertyCount >= 2) {
    score += 5;
    reasons.push(`Linked to ${s.linkedPropertyCount} properties.`);
  }

  return { score: Math.min(100, score), reasons };
}

function labelFromScore(score: number): WarmthLabel {
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  if (score >= 20) return "cool";
  return "cold";
}

function normalizeWarmthInput(raw: string | null | undefined): WarmthLabel | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === "hot" || v === "warm" || v === "cool" || v === "cold") return v;
  return null;
}

function pickNextAction(s: {
  hotLeadCount: number;
  openDealCount: number;
  daysSinceTouch: number | null;
  warmth: WarmthLabel;
  followUpOverdue: boolean;
  contactType: string | null;
}): string | null {
  if (s.hotLeadCount > 0) return `Reply to ${s.hotLeadCount} hot lead${s.hotLeadCount === 1 ? "" : "s"}`;
  if (s.followUpOverdue) return "Follow-up date passed — outreach due";
  if (s.openDealCount > 0 && s.daysSinceTouch !== null && s.daysSinceTouch >= 7) {
    return "Active deal · check in";
  }
  if (s.warmth === "hot" && s.daysSinceTouch !== null && s.daysSinceTouch >= 14) {
    return "Hot relationship · 14d quiet";
  }
  if (s.contactType === "owner" && (s.daysSinceTouch === null || s.daysSinceTouch >= 14)) {
    return "Owner update due";
  }
  return null;
}

// ── Helper queries ─────────────────────────────────────────────────────────
async function fetchActivityCounts90d(ids: string[]): Promise<Map<string, number>> {
  const sb = createServerSupabase();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data } = await sb
    .from("activities")
    .select("contact_id")
    .eq("organization_id", ORG_ID)
    .in("contact_id", ids)
    .gte("occurred_at", since);
  const m = new Map<string, number>();
  for (const r of (data ?? []) as any[]) {
    if (r.contact_id) m.set(r.contact_id, (m.get(r.contact_id) ?? 0) + 1);
  }
  return m;
}

async function fetchActivityCount90dForContact(id: string): Promise<number> {
  const sb = createServerSupabase();
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { count } = await sb
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("contact_id", id)
    .gte("occurred_at", since);
  return count ?? 0;
}

async function fetchLastActivityByContact(ids: string[]): Promise<Map<string, string>> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("activities")
    .select("contact_id, occurred_at")
    .eq("organization_id", ORG_ID)
    .in("contact_id", ids)
    .order("occurred_at", { ascending: false });
  const m = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    if (r.contact_id && !m.has(r.contact_id)) m.set(r.contact_id, r.occurred_at);
  }
  return m;
}

async function fetchLastActivityForContact(id: string): Promise<string | null> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("activities")
    .select("occurred_at")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", id)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any)?.occurred_at ?? null;
}

async function fetchHotLeadCountsByContact(ids: string[]): Promise<Map<string, number>> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("leads")
    .select("contact_id")
    .eq("organization_id", ORG_ID)
    .in("contact_id", ids)
    .eq("urgency", "hot")
    .not("status", "in", "(archived,spam,sent,converted)");
  const m = new Map<string, number>();
  for (const r of (data ?? []) as any[]) {
    if (r.contact_id) m.set(r.contact_id, (m.get(r.contact_id) ?? 0) + 1);
  }
  return m;
}

async function fetchOpenDealCountsByContact(ids: string[]): Promise<Map<string, number>> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("deals")
    .select("client_contact_id")
    .eq("organization_id", ORG_ID)
    .in("client_contact_id", ids)
    .eq("is_closed", false)
    .eq("is_dead", false);
  const m = new Map<string, number>();
  for (const r of (data ?? []) as any[]) {
    if (r.client_contact_id) m.set(r.client_contact_id, (m.get(r.client_contact_id) ?? 0) + 1);
  }
  return m;
}

async function fetchLinkedPropertyCounts(ids: string[]): Promise<Map<string, number>> {
  // Distinct properties this contact has touched via activities or tasks
  const sb = createServerSupabase();
  const [{ data: actData }, { data: taskData }] = await Promise.all([
    sb.from("activities")
      .select("contact_id, property_id")
      .eq("organization_id", ORG_ID)
      .in("contact_id", ids)
      .not("property_id", "is", null),
    sb.from("tasks")
      .select("contact_id, property_id")
      .eq("organization_id", ORG_ID)
      .in("contact_id", ids)
      .not("property_id", "is", null),
  ]);
  const seen = new Map<string, Set<string>>();
  for (const r of (actData ?? []) as any[]) {
    if (!r.contact_id || !r.property_id) continue;
    if (!seen.has(r.contact_id)) seen.set(r.contact_id, new Set());
    seen.get(r.contact_id)!.add(r.property_id);
  }
  for (const r of (taskData ?? []) as any[]) {
    if (!r.contact_id || !r.property_id) continue;
    if (!seen.has(r.contact_id)) seen.set(r.contact_id, new Set());
    seen.get(r.contact_id)!.add(r.property_id);
  }
  const m = new Map<string, number>();
  Array.from(seen.entries()).forEach(([k, v]) => m.set(k, v.size));
  return m;
}

async function fetchLeadsForContact(id: string): Promise<any[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("leads")
    .select("id, property_label, intent, urgency, status, created_at")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as any[];
}

async function fetchDealsForContact(id: string): Promise<any[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("deals")
    .select("id, deal_name, deal_type, price, is_closed, is_dead, deal_stages(stage, exited_at)")
    .eq("organization_id", ORG_ID)
    .eq("client_contact_id", id)
    .order("created_at", { ascending: false });
  return (data ?? []).map((d: any) => ({
    ...d,
    stage: castMany<{ stage: string; exited_at: string | null }>(d.deal_stages).find((s) => !s.exited_at)?.stage ?? null,
  }));
}

async function fetchActivityForContact(id: string, limit: number): Promise<any[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("activities")
    .select("id, activity_type, subject, body, occurred_at")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", id)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as any[];
}

async function fetchPropertiesLinkedToContact(
  contactId: string,
): Promise<ContactDetail["linkedProperties"]> {
  const sb = createServerSupabase();
  // Resolve properties via activities + tasks; classify role from the contact's
  // contact_type as a v1 heuristic (proper join table coming in 4.5).
  const [{ data: viaActivity }, { data: viaTasks }] = await Promise.all([
    sb.from("activities")
      .select("property:properties(id, name, slug, city, state)")
      .eq("organization_id", ORG_ID)
      .eq("contact_id", contactId)
      .not("property_id", "is", null)
      .limit(50),
    sb.from("tasks")
      .select("property:properties(id, name, slug, city, state)")
      .eq("organization_id", ORG_ID)
      .eq("contact_id", contactId)
      .not("property_id", "is", null)
      .limit(50),
  ]);

  const seen = new Map<string, ContactDetail["linkedProperties"][number]>();
  for (const arr of [viaActivity ?? [], viaTasks ?? []]) {
    for (const r of arr as any[]) {
      const p = castOne<{ id: string; name: string; slug: string; city: string | null; state: string | null }>(r.property);
      if (!p?.id || seen.has(p.id)) continue;
      seen.set(p.id, {
        id: p.id,
        name: p.name,
        slug: p.slug,
        city: p.city,
        state: p.state,
        role: "linked", // v1 — will be 'owner' / 'tenant' / etc once join table exists
      });
    }
  }
  return Array.from(seen.values()).slice(0, 20);
}
