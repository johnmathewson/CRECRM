/**
 * CRE OS — Prospector data layer.
 *
 * Cold inventory + lane configuration + enrollment + touches. The
 * companion to property-queries.ts: that one shows you warm assets, this
 * one shows you the universe of cold targets the agent is mining.
 *
 * Loaders:
 *   loadProspectorSnapshot()       → hub view (counts, lanes, hot replies)
 *   loadLaneList()                  → all lanes
 *   loadLaneDetail(id)             → one lane + its preview match count
 *   loadColdInventory(filters)     → browseable cold properties
 *   loadHotReplies()               → enrollments in 'engaged' state
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────

export type LaneStatus = "draft" | "active" | "paused" | "archived";
export type LaneTriggerType =
  | "pre_foreclosure"
  | "refi_maturity"
  | "tired_owner"
  | "failed_listing"
  | "below_market_rent"
  | "probate"
  | "custom";

export interface LaneFilters {
  asset_types?: string[];
  sub_types?: string[];
  counties?: string[];
  states?: string[];
  sqft_min?: number | null;
  sqft_max?: number | null;
  value_min?: number | null;
  value_max?: number | null;
  units_min?: number | null;
  units_max?: number | null;
  year_built_min?: number | null;
  year_built_max?: number | null;
  owner_types?: string[];
  min_years_owned?: number | null;
  owner_out_of_state?: boolean | null;
  /** for refi_maturity */
  trigger_window_months?: number | null;
  trigger_origination_year_min?: number | null;
  trigger_origination_year_max?: number | null;
  /** for pre_foreclosure */
  required_signal_flags?: string[];
}

export interface CadenceStep {
  day_offset: number;
  channel: "email" | "sms" | "call" | "letter" | "voicemail";
  template?: string;
  subject?: string;
  body?: string;
  notes?: string;
}

export interface ApprovalMode {
  email?: "auto" | "queue" | "manual";
  sms?: "auto" | "queue" | "manual";
  call?: "auto" | "queue" | "manual";
  letter?: "auto" | "queue" | "manual";
  voicemail?: "auto" | "queue" | "manual";
}

export interface Lane {
  id: string;
  name: string;
  description: string | null;
  status: LaneStatus;
  triggerType: LaneTriggerType;
  /** Which persona drives this lane's AI drafts. NULL falls back to looking
   *  up a persona whose slug matches the triggerType. */
  personaId: string | null;
  /** Persona slug + name, denormalized for display when joined */
  personaSlug: string | null;
  personaName: string | null;
  filters: LaneFilters;
  cadence: CadenceStep[];
  approvalMode: ApprovalMode;
  dailyTouchCap: number;
  weeklyEnrollmentCap: number;
  totalEnrolled: number;
  totalTouched: number;
  totalResponded: number;
  totalPromoted: number;
  /** Live count: how many enrollments are currently 'active' */
  liveEnrolled: number;
  /** Live count: how many properties currently match the filters but aren't yet enrolled */
  matchingNotEnrolled: number;
  createdAt: string;
  updatedAt: string;
}

export interface ColdProperty {
  id: string;
  slug: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  apn: string | null;
  assetType: string | null;
  subType: string | null;
  sqft: number | null;
  units: number | null;
  yearBuilt: number | null;
  estimatedValue: number | null;
  ownerNameRaw: string | null;
  ownerType: string | null;
  ownerOutOfState: boolean;
  yearsOwned: number | null;
  mortgageMaturity: string | null;
  signalFlags: string[];
  prospectorScore: number | null;
  /** Lanes this property is currently enrolled in (active only) */
  activeLanes: { id: string; name: string }[];

  // New richer fields (CoStar full-extraction)
  buildingClass: string | null;
  submarket: string | null;
  tenancy: string | null;
  percentLeased: number | null;
  capRate: number | null;
  daysOnMarket: number | null;
  forSaleStatus: string | null;
  forSalePrice: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  // Loan summary for at-a-glance
  loanLender: string | null;
  loanAmount: number | null;
  loanInterestRate: number | null;
  // True owner (LLC unmask)
  trueOwnerName: string | null;
  trueOwnerPhone: string | null;
  trueOwnerState: string | null;
  // Best-available phone (true owner > owner > prop manager > sales contact)
  bestPhone: string | null;
  bestPhoneSource: string | null;
}

export interface HotReply {
  enrollmentId: string;
  laneId: string;
  laneName: string;
  propertyId: string;
  propertyName: string;
  propertyAddress: string | null;
  contactId: string | null;
  contactName: string | null;
  /** What signal flipped them to 'engaged' */
  trigger: string;
  occurredAt: string;
}

export interface ProspectorSnapshot {
  totals: {
    coldInventory: number;
    activeLanes: number;
    inActiveCadence: number;
    hotReplies: number;
    touchesSentToday: number;
    touchesSent7d: number;
    promoted30d: number;
  };
  lanes: Lane[];
  hotReplies: HotReply[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toLane(row: Record<string, unknown>, liveEnrolled = 0, matchingNotEnrolled = 0): Lane {
  // persona join (when present) lands on row.persona — supabase returns
  // either an object or null for one-to-one foreign joins.
  const persona = (row.persona as { id?: string; slug?: string; name?: string } | null) ?? null;
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    status: row.status as LaneStatus,
    triggerType: row.trigger_type as LaneTriggerType,
    personaId: (row.persona_id as string) ?? persona?.id ?? null,
    personaSlug: persona?.slug ?? null,
    personaName: persona?.name ?? null,
    filters: (row.filters as LaneFilters) ?? {},
    cadence: (row.cadence as CadenceStep[]) ?? [],
    approvalMode: (row.approval_mode as ApprovalMode) ?? {},
    dailyTouchCap: (row.daily_touch_cap as number) ?? 50,
    weeklyEnrollmentCap: (row.weekly_enrollment_cap as number) ?? 25,
    totalEnrolled: (row.total_enrolled as number) ?? 0,
    totalTouched: (row.total_touched as number) ?? 0,
    totalResponded: (row.total_responded as number) ?? 0,
    totalPromoted: (row.total_promoted as number) ?? 0,
    liveEnrolled,
    matchingNotEnrolled,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ── Loaders ────────────────────────────────────────────────────────────────

export async function loadProspectorSnapshot(): Promise<ProspectorSnapshot> {
  const sb = createServerSupabase();

  const [
    coldCountRes,
    lanesRes,
    enrollmentsRes,
    hotRepliesRes,
    touches24hRes,
    touches7dRes,
    promoted30dRes,
  ] = await Promise.all([
    sb.from("properties").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "prospect"),
    sb.from("lanes").select("*").eq("organization_id", ORG_ID).order("created_at", { ascending: true }),
    sb.from("lane_enrollments").select("id, lane_id, status").eq("organization_id", ORG_ID),
    loadHotReplies(),
    sb.from("lane_touches").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "sent")
      .gte("sent_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    sb.from("lane_touches").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "sent")
      .gte("sent_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
    sb.from("lane_enrollments").select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID).eq("status", "promoted")
      .gte("exited_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
  ]);

  const lanes = (lanesRes.data ?? []) as Record<string, unknown>[];
  const enrollments = (enrollmentsRes.data ?? []) as Array<{ id: string; lane_id: string; status: string }>;

  const liveByLane = new Map<string, number>();
  for (const e of enrollments) {
    if (e.status === "active" || e.status === "engaged") {
      liveByLane.set(e.lane_id, (liveByLane.get(e.lane_id) ?? 0) + 1);
    }
  }

  const lanesOut = lanes.map((l) =>
    toLane(l, liveByLane.get(l.id as string) ?? 0, 0)
  );
  const activeLanes = lanesOut.filter((l) => l.status === "active").length;
  const inActiveCadence = enrollments.filter((e) => e.status === "active").length;

  return {
    totals: {
      coldInventory: coldCountRes.count ?? 0,
      activeLanes,
      inActiveCadence,
      hotReplies: hotRepliesRes.length,
      touchesSentToday: touches24hRes.count ?? 0,
      touchesSent7d: touches7dRes.count ?? 0,
      promoted30d: promoted30dRes.count ?? 0,
    },
    lanes: lanesOut,
    hotReplies: hotRepliesRes,
  };
}

export async function loadLaneList(): Promise<Lane[]> {
  const sb = createServerSupabase();
  const [lanesRes, enrollmentsRes] = await Promise.all([
    sb.from("lanes").select("*").eq("organization_id", ORG_ID).order("created_at", { ascending: true }),
    sb.from("lane_enrollments").select("lane_id, status").eq("organization_id", ORG_ID),
  ]);

  const liveByLane = new Map<string, number>();
  for (const e of (enrollmentsRes.data ?? []) as Array<{ lane_id: string; status: string }>) {
    if (e.status === "active" || e.status === "engaged") {
      liveByLane.set(e.lane_id, (liveByLane.get(e.lane_id) ?? 0) + 1);
    }
  }

  return ((lanesRes.data ?? []) as Record<string, unknown>[]).map((l) =>
    toLane(l, liveByLane.get(l.id as string) ?? 0, 0)
  );
}

export async function loadLaneDetail(id: string): Promise<Lane | null> {
  const sb = createServerSupabase();
  const { data, error } = await sb
    .from("lanes")
    .select("*, persona:personas(id, slug, name)")
    .eq("organization_id", ORG_ID)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  // Live counts
  const [enrollmentsRes, matchingCount] = await Promise.all([
    sb.from("lane_enrollments").select("status").eq("organization_id", ORG_ID).eq("lane_id", id),
    countMatchingProperties((data.filters as LaneFilters) ?? {}, id),
  ]);

  const liveEnrolled = ((enrollmentsRes.data ?? []) as Array<{ status: string }>)
    .filter((r) => r.status === "active" || r.status === "engaged").length;

  return toLane(data, liveEnrolled, matchingCount);
}

export async function countMatchingProperties(
  filters: LaneFilters,
  excludeAlreadyEnrolledInLane?: string
): Promise<number> {
  const sb = createServerSupabase();
  let q = sb.from("properties").select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("status", "prospect");

  if (filters.asset_types?.length) q = q.in("asset_type", filters.asset_types);
  if (filters.sub_types?.length) q = q.in("sub_type", filters.sub_types);
  if (filters.counties?.length) q = q.in("county", filters.counties);
  if (filters.states?.length) q = q.in("state", filters.states);
  if (filters.sqft_min != null) q = q.gte("sqft", filters.sqft_min);
  if (filters.sqft_max != null) q = q.lte("sqft", filters.sqft_max);
  if (filters.value_min != null) q = q.gte("estimated_value", filters.value_min);
  if (filters.value_max != null) q = q.lte("estimated_value", filters.value_max);
  if (filters.units_min != null) q = q.gte("units", filters.units_min);
  if (filters.units_max != null) q = q.lte("units", filters.units_max);
  if (filters.year_built_min != null) q = q.gte("year_built", filters.year_built_min);
  if (filters.year_built_max != null) q = q.lte("year_built", filters.year_built_max);
  if (filters.owner_types?.length) q = q.in("owner_type", filters.owner_types);
  if (filters.min_years_owned != null) q = q.gte("years_owned", filters.min_years_owned);

  if (filters.required_signal_flags?.length) {
    q = q.contains("prospector_signal_flags", filters.required_signal_flags);
  }

  if (filters.trigger_window_months != null) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() + filters.trigger_window_months);
    q = q.lte("mortgage_maturity_date", cutoff.toISOString().slice(0, 10))
      .gte("mortgage_maturity_date", new Date().toISOString().slice(0, 10));
  }

  const { count } = await q;
  return count ?? 0;
}

export interface ColdInventoryFilters {
  q?: string;
  assetType?: string;
  county?: string;
  signalFlag?: string;
  laneId?: string;
  limit?: number;
  offset?: number;
}

export async function loadColdInventory(filters: ColdInventoryFilters = {}): Promise<{
  rows: ColdProperty[];
  total: number;
}> {
  const sb = createServerSupabase();
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;

  let q = sb.from("properties").select(`
    id, slug, name, address, city, state, county, apn, asset_type, sub_type,
    sqft, units, year_built, estimated_value, owner_name_raw, owner_type,
    owner_state, years_owned, mortgage_maturity_date, prospector_signal_flags,
    prospector_score,
    building_class, submarket, tenancy, percent_leased, cap_rate,
    days_on_market, for_sale_status, for_sale_price,
    last_sale_date, last_sale_price,
    mortgage_lender, mortgage_balance, loan_interest_rate,
    true_owner_name, true_owner_phone, true_owner_state,
    owner_phone, property_manager_phone, sales_contact_phone
  `, { count: "exact" })
    .eq("organization_id", ORG_ID)
    .eq("status", "prospect");

  if (filters.q) {
    q = q.or(`name.ilike.%${filters.q}%,address.ilike.%${filters.q}%,owner_name_raw.ilike.%${filters.q}%`);
  }
  if (filters.assetType) q = q.eq("asset_type", filters.assetType);
  if (filters.county) q = q.eq("county", filters.county);
  if (filters.signalFlag) q = q.contains("prospector_signal_flags", [filters.signalFlag]);

  q = q.order("prospector_score", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, count } = await q;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const propertyIds = rows.map((r) => r.id as string);

  // Pull active enrollments to surface "in lanes" badge
  const enrollmentMap = new Map<string, { id: string; name: string }[]>();
  if (propertyIds.length > 0) {
    const { data: enr } = await sb
      .from("lane_enrollments")
      .select("property_id, lane:lanes(id, name)")
      .eq("organization_id", ORG_ID)
      .in("property_id", propertyIds)
      .in("status", ["active", "engaged"]);
    for (const e of (enr ?? []) as unknown as Array<{
      property_id: string;
      lane: { id: string; name: string } | { id: string; name: string }[] | null;
    }>) {
      const lane = Array.isArray(e.lane) ? e.lane[0] : e.lane;
      if (!lane) continue;
      const arr = enrollmentMap.get(e.property_id) ?? [];
      arr.push({ id: lane.id, name: lane.name });
      enrollmentMap.set(e.property_id, arr);
    }
  }

  return {
    total: count ?? 0,
    rows: rows.map((r): ColdProperty => {
      // Best phone: true owner > regular owner > property manager > sales contact
      const trueOwnerPhone = (r.true_owner_phone as string) ?? null;
      const ownerPhone = (r.owner_phone as string) ?? null;
      const pmPhone = (r.property_manager_phone as string) ?? null;
      const salesPhone = (r.sales_contact_phone as string) ?? null;
      let bestPhone: string | null = null;
      let bestPhoneSource: string | null = null;
      if (trueOwnerPhone) { bestPhone = trueOwnerPhone; bestPhoneSource = "True Owner"; }
      else if (ownerPhone) { bestPhone = ownerPhone; bestPhoneSource = "Owner"; }
      else if (pmPhone) { bestPhone = pmPhone; bestPhoneSource = "Property Manager"; }
      else if (salesPhone) { bestPhone = salesPhone; bestPhoneSource = "Sales Contact"; }

      return {
        id: r.id as string,
        slug: (r.slug as string) ?? null,
        name: (r.name as string) ?? null,
        address: (r.address as string) ?? null,
        city: (r.city as string) ?? null,
        state: (r.state as string) ?? null,
        county: (r.county as string) ?? null,
        apn: (r.apn as string) ?? null,
        assetType: (r.asset_type as string) ?? null,
        subType: (r.sub_type as string) ?? null,
        sqft: (r.sqft as number) ?? null,
        units: (r.units as number) ?? null,
        yearBuilt: (r.year_built as number) ?? null,
        estimatedValue: (r.estimated_value as number) ?? null,
        ownerNameRaw: (r.owner_name_raw as string) ?? null,
        ownerType: (r.owner_type as string) ?? null,
        ownerOutOfState: !!r.owner_state && r.owner_state !== r.state,
        yearsOwned: (r.years_owned as number) ?? null,
        mortgageMaturity: (r.mortgage_maturity_date as string) ?? null,
        signalFlags: ((r.prospector_signal_flags as string[]) ?? []),
        prospectorScore: (r.prospector_score as number) ?? null,
        activeLanes: enrollmentMap.get(r.id as string) ?? [],
        // New richer fields
        buildingClass: (r.building_class as string) ?? null,
        submarket: (r.submarket as string) ?? null,
        tenancy: (r.tenancy as string) ?? null,
        percentLeased: (r.percent_leased as number) ?? null,
        capRate: (r.cap_rate as number) ?? null,
        daysOnMarket: (r.days_on_market as number) ?? null,
        forSaleStatus: (r.for_sale_status as string) ?? null,
        forSalePrice: (r.for_sale_price as number) ?? null,
        lastSaleDate: (r.last_sale_date as string) ?? null,
        lastSalePrice: (r.last_sale_price as number) ?? null,
        loanLender: (r.mortgage_lender as string) ?? null,
        loanAmount: (r.mortgage_balance as number) ?? null,
        loanInterestRate: (r.loan_interest_rate as number) ?? null,
        trueOwnerName: (r.true_owner_name as string) ?? null,
        trueOwnerPhone,
        trueOwnerState: (r.true_owner_state as string) ?? null,
        bestPhone,
        bestPhoneSource,
      };
    }),
  };
}

export async function loadHotReplies(): Promise<HotReply[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("lane_enrollments")
    .select(`
      id, lane_id, property_id, exit_reason, exited_at, updated_at,
      lane:lanes(id, name),
      property:properties(id, name, address)
    `)
    .eq("organization_id", ORG_ID)
    .eq("status", "engaged")
    .order("updated_at", { ascending: false })
    .limit(50);

  type Row = {
    id: string;
    lane_id: string;
    property_id: string;
    exit_reason: string | null;
    updated_at: string;
    lane: { id: string; name: string } | { id: string; name: string }[] | null;
    property:
      | { id: string; name: string | null; address: string | null }
      | { id: string; name: string | null; address: string | null }[]
      | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => {
    const lane = Array.isArray(r.lane) ? r.lane[0] : r.lane;
    const property = Array.isArray(r.property) ? r.property[0] : r.property;
    return {
      enrollmentId: r.id,
      laneId: r.lane_id,
      laneName: lane?.name ?? "(unknown lane)",
      propertyId: r.property_id,
      propertyName: property?.name ?? "(unnamed property)",
      propertyAddress: property?.address ?? null,
      contactId: null,
      contactName: null,
      trigger: r.exit_reason ?? "engaged",
      occurredAt: r.updated_at,
    };
  });
}

// ── Aggregates for filter dropdowns ────────────────────────────────────────

export async function loadProspectorFacets(): Promise<{
  counties: string[];
  assetTypes: string[];
  signalFlags: string[];
}> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("properties")
    .select("county, asset_type, prospector_signal_flags")
    .eq("organization_id", ORG_ID)
    .eq("status", "prospect")
    .limit(5000); // good enough for facet aggregation

  const counties = new Set<string>();
  const assetTypes = new Set<string>();
  const signalFlags = new Set<string>();
  for (const r of (data ?? []) as Array<{
    county: string | null;
    asset_type: string | null;
    prospector_signal_flags: string[] | null;
  }>) {
    if (r.county) counties.add(r.county);
    if (r.asset_type) assetTypes.add(r.asset_type);
    for (const f of r.prospector_signal_flags ?? []) signalFlags.add(f);
  }

  return {
    counties: Array.from(counties).sort(),
    assetTypes: Array.from(assetTypes).sort(),
    signalFlags: Array.from(signalFlags).sort(),
  };
}
