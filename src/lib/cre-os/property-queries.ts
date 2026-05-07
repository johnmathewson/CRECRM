/**
 * CRE OS — Property workspace + property list data layer.
 *
 * One module, two top-level loaders:
 *   loadPropertyList(filters)     → cards for /cre-os/properties
 *   loadPropertyDetail(slug)      → full workspace for /cre-os/properties/[slug]
 *
 * Both scoped to ORG_ID. Queries fan out in parallel where independent.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Shared types ───────────────────────────────────────────────────────────
export interface PropertyListFilters {
  q?: string;
  assetType?: string;
  status?: string;
  yourRole?: string;
}

export interface PropertyCard {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  assetType: string | null;
  status: string | null;
  pipelineStage: string | null;
  yourRole: string | null;
  transactionType: string | null;
  askingPrice: number | null;
  sqft: number | null;
  noi: number | null;
  capRate: number | null;
  occupancyPct: number | null;
  /** Days since the last activity touched this property */
  daysSinceTouch: number | null;
  /** Open task count */
  openTasks: number;
  /** Hot-lead count referencing this property */
  hotLeads: number;
}

export interface PropertyKeyContact {
  id: string;
  fullName: string;
  role: "owner" | "tenant" | "broker" | "buyer_rep" | "lender" | "attorney" | "vendor" | "other";
  email: string | null;
  phone: string | null;
  /** Days since we last touched them */
  daysSinceTouch: number | null;
}

export interface PropertyTask {
  id: string;
  title: string;
  due: string;          // pre-formatted ("Today" / "Overdue · May 4" / "May 12")
  tone: "coral" | "amber" | "neutral";
  status: string | null;
}

export interface PropertyActivityRow {
  id: string;
  when: string;
  who: string;
  did: string;
  subject: string | null;
  body: string | null;
  rawTime: string | null;
}

export interface PropertyLead {
  id: string;
  senderName: string | null;
  senderEmail: string | null;
  intent: string | null;
  urgency: "hot" | "warm" | "cold" | null;
  status: string | null;
  qualifierSummary: string | null;
  createdAt: string | null;
}

export interface PropertyDeal {
  id: string;
  dealName: string | null;
  dealType: string | null;
  price: number | null;
  probabilityPct: number | null;
  expectedClose: string | null;
  isClosed: boolean;
  isDead: boolean;
  currentStage: string | null;
}

export interface PropertyValuationSummary {
  /** Current NOI from properties.noi */
  inPlaceNoi: number | null;
  capRate: number | null;
  askingPrice: number | null;
  pricePerSf: number | null;
  /** Comp-driven rent rate (median of nearby lease comps for matching asset type, in $/SF/yr) */
  compMedianRent: number | null;
  /** Comp count used */
  compCount: number;
  /** When comps were sampled (timestamp string) */
  compsSampledAt: string;
  /** Rough sale-comp price-per-SF range, low/mid/high */
  saleCompPpsf: { low: number; mid: number; high: number; count: number } | null;
}

export interface PropertyAIInsight {
  id: string;
  headline: string;
  caption: string;
  tone: "coral" | "teal" | "amber" | "neutral";
  href?: string;
}

export interface PropertyDetail {
  // Base
  id: string;
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  assetType: string | null;
  status: string | null;
  pipelineStage: string | null;
  yourRole: string | null;
  transactionType: string | null;
  askingPrice: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  noi: number | null;
  capRate: number | null;
  occupancyPct: number | null;
  description: string | null;
  notes: string | null;
  createdAt: string | null;

  // Connected data
  keyContacts: PropertyKeyContact[];
  tasks: PropertyTask[];
  activity: PropertyActivityRow[];
  leads: PropertyLead[];
  deals: PropertyDeal[];
  valuation: PropertyValuationSummary;
  insights: PropertyAIInsight[];
}

// ── List loader ────────────────────────────────────────────────────────────
export async function loadPropertyList(filters: PropertyListFilters = {}): Promise<PropertyCard[]> {
  const sb = createServerSupabase();

  // Pull base records with the filters applied
  let q = sb
    .from("properties")
    .select(
      "id, slug, name, address, city, state, asset_type, status, asking_price, sqft, noi, cap_rate, occupancy_pct, your_role, transaction_type, pipeline_stage, created_at",
    )
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false });

  if (filters.assetType) q = q.eq("asset_type", filters.assetType);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.yourRole) q = q.eq("your_role", filters.yourRole);
  if (filters.q && filters.q.trim()) {
    const term = `%${filters.q.trim()}%`;
    q = q.or(`name.ilike.${term},address.ilike.${term},city.ilike.${term}`);
  }

  const { data: rows } = await q.limit(120);
  const props = (rows ?? []) as any[];
  if (!props.length) return [];
  const ids = props.map((p) => p.id);

  // Aggregate signals — one query each, merge by property_id
  const [activityMap, taskMap, hotLeadMap] = await Promise.all([
    fetchLastActivityByProperty(ids),
    fetchOpenTaskCounts(ids),
    fetchHotLeadCounts(ids),
  ]);

  return props.map((p): PropertyCard => {
    const lastActivityIso = activityMap.get(p.id);
    const daysSinceTouch = lastActivityIso ? daysSince(lastActivityIso) : null;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      address: p.address,
      city: p.city,
      state: p.state,
      assetType: p.asset_type,
      status: p.status,
      pipelineStage: p.pipeline_stage,
      yourRole: p.your_role,
      transactionType: p.transaction_type,
      askingPrice: numOrNull(p.asking_price),
      sqft: p.sqft ?? null,
      noi: numOrNull(p.noi),
      capRate: numOrNull(p.cap_rate),
      occupancyPct: numOrNull(p.occupancy_pct),
      daysSinceTouch,
      openTasks: taskMap.get(p.id) ?? 0,
      hotLeads: hotLeadMap.get(p.id) ?? 0,
    };
  });
}

// ── Detail loader ──────────────────────────────────────────────────────────
export async function loadPropertyDetail(slug: string): Promise<PropertyDetail | null> {
  const sb = createServerSupabase();

  const { data: p } = await sb
    .from("properties")
    .select(
      "id, slug, name, address, city, state, zip, asset_type, status, pipeline_stage, your_role, transaction_type, asking_price, sqft, year_built, noi, cap_rate, occupancy_pct, description, notes, created_at",
    )
    .eq("organization_id", ORG_ID)
    .eq("slug", slug)
    .maybeSingle();

  if (!p) return null;

  // Fan out everything we need
  const [tasks, activity, leads, deals, valuation, contactRows] = await Promise.all([
    fetchPropertyTasks(p.id),
    fetchPropertyActivity(p.id),
    fetchPropertyLeads(p.id),
    fetchPropertyDeals(p.id),
    fetchPropertyValuation(p),
    fetchPropertyKeyContacts(p.id),
  ]);

  const detail: PropertyDetail = {
    id: p.id,
    slug: p.slug,
    name: p.name,
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    assetType: p.asset_type,
    status: p.status,
    pipelineStage: p.pipeline_stage,
    yourRole: p.your_role,
    transactionType: p.transaction_type,
    askingPrice: numOrNull(p.asking_price),
    sqft: p.sqft ?? null,
    yearBuilt: p.year_built ?? null,
    noi: numOrNull(p.noi),
    capRate: numOrNull(p.cap_rate),
    occupancyPct: numOrNull(p.occupancy_pct),
    description: p.description ?? null,
    notes: p.notes ?? null,
    createdAt: p.created_at ?? null,
    keyContacts: contactRows,
    tasks,
    activity,
    leads,
    deals,
    valuation,
    insights: [], // populated below
  };

  detail.insights = synthesizeInsights(detail);
  return detail;
}

// ── Helper queries ─────────────────────────────────────────────────────────
async function fetchLastActivityByProperty(ids: string[]): Promise<Map<string, string>> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("activities")
    .select("property_id, occurred_at")
    .eq("organization_id", ORG_ID)
    .in("property_id", ids)
    .order("occurred_at", { ascending: false });
  const m = new Map<string, string>();
  for (const r of (data ?? []) as any[]) {
    if (!m.has(r.property_id)) m.set(r.property_id, r.occurred_at);
  }
  return m;
}

async function fetchOpenTaskCounts(ids: string[]): Promise<Map<string, number>> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("tasks")
    .select("property_id")
    .eq("organization_id", ORG_ID)
    .in("property_id", ids)
    .neq("status", "done");
  const m = new Map<string, number>();
  for (const r of (data ?? []) as any[]) {
    m.set(r.property_id, (m.get(r.property_id) ?? 0) + 1);
  }
  return m;
}

async function fetchHotLeadCounts(ids: string[]): Promise<Map<string, number>> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("leads")
    .select("property_id")
    .eq("organization_id", ORG_ID)
    .in("property_id", ids)
    .eq("urgency", "hot")
    .not("status", "in", "(archived,spam,sent,converted)");
  const m = new Map<string, number>();
  for (const r of (data ?? []) as any[]) {
    if (r.property_id) m.set(r.property_id, (m.get(r.property_id) ?? 0) + 1);
  }
  return m;
}

async function fetchPropertyTasks(propertyId: string): Promise<PropertyTask[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("tasks")
    .select("id, title, due_date, status")
    .eq("organization_id", ORG_ID)
    .eq("property_id", propertyId)
    .neq("status", "done")
    .order("due_date", { ascending: true })
    .limit(15);
  const today = new Date().toISOString().slice(0, 10);
  return (data ?? []).map((t: any): PropertyTask => {
    const due = t.due_date ?? null;
    let tone: PropertyTask["tone"] = "neutral";
    if (due && due < today) tone = "coral";
    else if (due === today) tone = "coral";
    else if (due) tone = "neutral";
    return { id: t.id, title: t.title, due: formatDueLabel(due, today), tone, status: t.status };
  });
}

async function fetchPropertyActivity(propertyId: string): Promise<PropertyActivityRow[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("activities")
    .select("id, activity_type, subject, body, occurred_at")
    .eq("organization_id", ORG_ID)
    .eq("property_id", propertyId)
    .order("occurred_at", { ascending: false })
    .limit(40);
  return (data ?? []).map((r: any): PropertyActivityRow => ({
    id: r.id,
    when: relativeTime(r.occurred_at),
    who: "You",
    did: humanizeActivity(r.activity_type),
    subject: r.subject ?? null,
    body: r.body ?? null,
    rawTime: r.occurred_at ?? null,
  }));
}

async function fetchPropertyLeads(propertyId: string): Promise<PropertyLead[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("leads")
    .select("id, sender_name, sender_email, intent, urgency, status, qualifier_summary, created_at")
    .eq("organization_id", ORG_ID)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((r: any): PropertyLead => ({
    id: r.id,
    senderName: r.sender_name ?? null,
    senderEmail: r.sender_email ?? null,
    intent: r.intent ?? null,
    urgency: r.urgency ?? null,
    status: r.status ?? null,
    qualifierSummary: r.qualifier_summary ?? null,
    createdAt: r.created_at ?? null,
  }));
}

async function fetchPropertyDeals(propertyId: string): Promise<PropertyDeal[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("deals")
    .select("id, deal_name, deal_type, price, probability_pct, expected_close, is_closed, is_dead, deal_stages(stage, exited_at)")
    .eq("organization_id", ORG_ID)
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r: any): PropertyDeal => {
    const currentStage = (r.deal_stages ?? []).find((s: any) => !s.exited_at)?.stage ?? null;
    return {
      id: r.id,
      dealName: r.deal_name,
      dealType: r.deal_type,
      price: numOrNull(r.price),
      probabilityPct: numOrNull(r.probability_pct),
      expectedClose: r.expected_close,
      isClosed: !!r.is_closed,
      isDead: !!r.is_dead,
      currentStage,
    };
  });
}

async function fetchPropertyValuation(p: any): Promise<PropertyValuationSummary> {
  const sb = createServerSupabase();
  // Try comp lookup if we have a usable address — geocode is too heavy here, so
  // fall back to asset-type-only median if no city/state present yet.
  let compMedianRent: number | null = null;
  let compCount = 0;
  let saleCompPpsf: PropertyValuationSummary["saleCompPpsf"] = null;

  // Use the lease_comps table directly with a city/state filter — fast and good
  // enough for the workspace summary. find_nearby_comps RPC needs lat/lng we
  // don't always have on the property record.
  if (p.city && p.state) {
    const [{ data: leaseRows }, { data: saleRows }] = await Promise.all([
      sb
        .from("lease_comps")
        .select("rent_per_sqft, sqft")
        .eq("organization_id", ORG_ID)
        .eq("city", p.city)
        .eq("state", p.state)
        .ilike("asset_type", p.asset_type ?? "%"),
      sb
        .from("sale_comps")
        .select("price_per_sqft")
        .eq("organization_id", ORG_ID)
        .eq("city", p.city)
        .eq("state", p.state)
        .ilike("asset_type", p.asset_type ?? "%")
        .not("price_per_sqft", "is", null),
    ]);

    const rents = (leaseRows ?? [])
      .map((r: any) => Number(r.rent_per_sqft))
      .filter((n: number) => Number.isFinite(n) && n > 0);
    if (rents.length) {
      compMedianRent = median(rents);
      compCount = rents.length;
    }

    const ppsfs = (saleRows ?? [])
      .map((r: any) => Number(r.price_per_sqft))
      .filter((n: number) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (ppsfs.length >= 2) {
      const trimmed = ppsfs.length > 4 ? ppsfs.slice(1, -1) : ppsfs;
      saleCompPpsf = {
        low: trimmed[0],
        mid: median(trimmed),
        high: trimmed[trimmed.length - 1],
        count: trimmed.length,
      };
    }
  }

  return {
    inPlaceNoi: numOrNull(p.noi),
    capRate: numOrNull(p.cap_rate),
    askingPrice: numOrNull(p.asking_price),
    pricePerSf: numOrNull(p.asking_price) && numOrNull(p.sqft)
      ? Math.round((Number(p.asking_price) / Number(p.sqft)) * 100) / 100
      : null,
    compMedianRent,
    compCount,
    compsSampledAt: new Date().toISOString(),
    saleCompPpsf,
  };
}

async function fetchPropertyKeyContacts(propertyId: string): Promise<PropertyKeyContact[]> {
  const sb = createServerSupabase();
  // Pull contacts that have ANY task or activity tied to this property.
  // Simple v1; later we'll formalize property↔contact relationship via a join table.
  const [{ data: viaActivity }, { data: viaTasks }] = await Promise.all([
    sb
      .from("activities")
      .select("contact:contacts(id, full_name, email, phone, contact_type)")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .not("contact_id", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(30),
    sb
      .from("tasks")
      .select("contact:contacts(id, full_name, email, phone, contact_type)")
      .eq("organization_id", ORG_ID)
      .eq("property_id", propertyId)
      .not("contact_id", "is", null)
      .limit(30),
  ]);

  const seen = new Set<string>();
  const merged: PropertyKeyContact[] = [];
  for (const arr of [viaActivity ?? [], viaTasks ?? []]) {
    for (const r of arr as any[]) {
      const c = r.contact;
      if (!c?.id || seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push({
        id: c.id,
        fullName: c.full_name ?? "(no name)",
        role: (c.contact_type as PropertyKeyContact["role"]) || "other",
        email: c.email ?? null,
        phone: c.phone ?? null,
        daysSinceTouch: null,
      });
    }
  }
  return merged.slice(0, 12);
}

// ── AI insight synthesis (deterministic v1; Phase 2.5 layers Haiku on top) ─
function synthesizeInsights(p: PropertyDetail): PropertyAIInsight[] {
  const out: PropertyAIInsight[] = [];

  // Owner check-in pressure
  const ownerLastTouch = (p.activity[0]?.rawTime ?? null);
  const daysQuiet = ownerLastTouch ? daysSince(ownerLastTouch) : null;
  if (daysQuiet !== null && daysQuiet >= 12) {
    out.push({
      id: "owner-quiet",
      headline: `Owner hasn't been updated in ${daysQuiet} days`,
      caption: "Premium owner relationships expect a beat every two weeks. Send a status note.",
      tone: "coral",
    });
  }

  // Hot leads not yet followed up
  const hotLeadCount = p.leads.filter((l) => l.urgency === "hot").length;
  if (hotLeadCount > 0) {
    out.push({
      id: "hot-leads",
      headline: `${hotLeadCount} hot lead${hotLeadCount === 1 ? "" : "s"} on this asset`,
      caption: "Inbound interest the AI flagged hot. Tap to review and respond.",
      tone: "coral",
      href: `/cre-os/inbox?property=${p.id}`,
    });
  }

  // Cap-rate vs comps tension
  if (p.capRate && p.valuation.saleCompPpsf && p.askingPrice && p.noi) {
    const compMidValue = p.valuation.saleCompPpsf.mid * (p.sqft ?? 0);
    if (compMidValue > 0 && Math.abs(p.askingPrice - compMidValue) / compMidValue > 0.1) {
      const tone = p.askingPrice > compMidValue ? "amber" : "teal";
      const verb = p.askingPrice > compMidValue ? "above" : "below";
      out.push({
        id: "cap-tension",
        headline: `Asking ${verb} comp midpoint`,
        caption: `Comps suggest ~${formatMoney(compMidValue)} on $/SF basis. Worth revisiting the pricing narrative.`,
        tone,
      });
    }
  }

  // Open tasks pile-up
  if (p.tasks.length >= 3) {
    out.push({
      id: "task-pile",
      headline: `${p.tasks.length} open tasks on this asset`,
      caption: "Worth blocking time to clear the backlog.",
      tone: "amber",
    });
  }

  // Closing soon
  const closing = p.deals.find((d) => !d.isClosed && !d.isDead && d.expectedClose && new Date(d.expectedClose) <= new Date(Date.now() + 7 * 86400000));
  if (closing) {
    out.push({
      id: "closing-soon",
      headline: `Closes ${closing.expectedClose}`,
      caption: "Confirm DD checklist, lender, and signature path.",
      tone: "teal",
    });
  }

  // Active listing with no recent activity
  if ((p.status === "listed" || p.status === "active") && (daysQuiet === null || daysQuiet > 7)) {
    out.push({
      id: "stale-listing",
      headline: "Active listing, no recent activity",
      caption: "Listing performance signals will surface here once Phase 6 lands.",
      tone: "neutral",
    });
  }

  return out.slice(0, 6);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function formatDueLabel(dateStr: string | null, today: string): string {
  if (!dateStr) return "—";
  if (dateStr === today) return "Today";
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === tomorrow) return "Tomorrow";
  if (dateStr < today) return `Overdue · ${formatShortDate(dateStr)}`;
  return formatShortDate(dateStr);
}

function formatShortDate(s: string): string {
  const [y, m, d] = s.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[(m ?? 1) - 1]} ${d}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatShortDate(new Date(t).toISOString().slice(0, 10));
}

function humanizeActivity(t: string | null | undefined): string {
  switch ((t ?? "").toLowerCase()) {
    case "email": return "emailed";
    case "call": return "called";
    case "meeting": return "met with";
    case "tour": return "toured";
    case "note": return "noted";
    case "stage_change": return "advanced stage";
    case "valuation_run": return "ran valuation";
    case "comp_import": return "imported comps";
    case "doc_upload": return "uploaded a document";
    case "task_complete": return "completed a task";
    default: return "updated";
  }
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + Math.round(n).toLocaleString();
}
