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
import {
  daysSince,
  formatDueLabel,
  formatShortDate,
  humanizeActivity,
  numOrNull,
  relativeTime,
} from "./time-utils";

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
  /** Overdue task count */
  overdueTasks: number;
  /** Hot-lead count referencing this property */
  hotLeads: number;

  /** Intelligence flags — booleans that drive triage filters and badges */
  isHot: boolean;          // any unanswered hot lead
  isQuiet: boolean;        // listed/active and 12+ days since last touch
  isStale: boolean;        // listed and > 14 days since last touch (stronger signal)
  isMissingValuation: boolean; // listed/active without noi+capRate set
  isClosingSoon: boolean;  // not yet wired (needs deal join); reserved for future

  /**
   * Priority score — higher = more attention-worthy. Drives "Today's focus"
   * sort. Combines hot leads, overdue tasks, stage staleness, missing valuation.
   * Cards score zero when nothing's pending.
   */
  priorityScore: number;

  /** One-line, human-readable next action — null when calm */
  nextAction: string | null;
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

/** One row in the property's document_inventory. The AI references this list
 *  when a buyer asks for specific documents — to know (a) whether we have it
 *  and (b) what disclosure tier it requires. */
export interface DocumentInventoryItem {
  name: string;
  /** Disclosure tier:
   *    "public"     — share freely (flyer, asking price, building basics)
   *    "qualified"  — share after light buyer qualification (full OM, rent roll summary)
   *    "nda"        — share only after NDA + buyer review (full leases, op statements)
   *    "restricted" — never share without explicit broker approval (seller motivation, bottom-line price) */
  tier: "public" | "qualified" | "nda" | "restricted";
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
  county: string | null;
  apn: string | null;
  assetType: string | null;
  subType: string | null;
  status: string | null;
  pipelineStage: string | null;
  yourRole: string | null;
  transactionType: string | null;
  askingPrice: number | null;
  leaseRate: number | null;
  sqft: number | null;
  units: number | null;
  acreage: number | null;
  yearBuilt: number | null;
  noi: number | null;
  capRate: number | null;
  occupancyPct: number | null;
  pricePerSf: number | null;

  // Physical attributes — the kind of detail brokers list on a flyer
  parkingSpaces: number | null;
  parkingRatio: string | null;
  zoning: string | null;
  totalBuildings: number | null;
  numberOfStories: number | null;

  // Marketing copy + assets — fuel for OM / listing description / flyer
  headline: string | null;
  description: string | null;
  notes: string | null;
  /** Optional anchor intel for AI outreach about this property — broker-authored.
   *  Injected into the personalizer prompt when present. Lives in properties.marketing_notes. */
  marketingNotes: string | null;
  /** Marketing bullet points — jsonb array of strings. PHYSICAL / use-case
   *  highlights of the building (what it IS, how it can be used). */
  highlights: string[];
  /** Investment-thesis bullets — jsonb array of strings. WHY a buyer should
   *  buy. OM-style. Separate from `highlights` so the UI can render them as
   *  their own section and the flyer/OM can pull just the thesis bullets. */
  investmentHighlights: string[];
  /** Public URL of the latest generated Offering Memorandum PDF in the
   *  marketing-pdfs Storage bucket. Null when no OM has been generated. */
  omPdfUrl: string | null;
  /** When the latest OM was generated. Surfaced in the UI as "Generated X ago". */
  omGeneratedAt: string | null;
  /** Image gallery — jsonb array. Shape varies historically (some have
   *  {url, caption}, some are bare URLs), so kept loose. */
  images: any[];
  /** Per-property document inventory + tier — used by the AI to know what
   *  to release and what to gate. Lives in properties.document_inventory. */
  documentInventory: DocumentInventoryItem[];
  /** Where this property record came from. Useful for distinguishing
   *  John-curated rows from public-record imports. */
  dataSource: string | null;
  createdAt: string | null;

  // External listing identity + state
  crexiUrl: string | null;
  crexiListingId: string | null;
  loopnetUrl: string | null;
  publishToWebsite: boolean | null;

  // Owner identity (from CoStar — True Owner is LLC unmask)
  ownerNameRaw: string | null;
  ownerType: string | null;
  ownerState: string | null;
  ownerPhone: string | null;
  ownerContactName: string | null;
  ownerMailingAddress: string | null;
  ownerMailingCity: string | null;
  ownerMailingState: string | null;
  ownerMailingZip: string | null;
  trueOwnerName: string | null;
  trueOwnerPhone: string | null;
  trueOwnerContactName: string | null;
  trueOwnerAddress: string | null;
  trueOwnerCity: string | null;
  trueOwnerState: string | null;
  trueOwnerZip: string | null;
  /** Recorded owner — county-record name, may differ from CoStar's
   *  "owner" (which can be a subsidiary or operating entity). Useful
   *  for skip-tracing when CoStar's owner is generic. */
  recordedOwnerName: string | null;
  recordedOwnerPhone: string | null;
  recordedOwnerAddress: string | null;

  // Loan / debt
  mortgageMaturityDate: string | null;
  mortgageOriginationDate: string | null;
  mortgageBalance: number | null;
  mortgageLender: string | null;
  loanInterestRate: number | null;
  loanInterestRateType: string | null;
  loanType: string | null;
  loanCollateralType: string | null;
  /** Originating broker/firm on the loan. Useful for refi outreach intel. */
  loanOriginator: string | null;

  // Sale history
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  yearsOwned: number | null;
  estimatedValue: number | null;
  /** Computed signal score from the prospector enrichment pipeline. */
  prospectorScore: number | null;

  // Listing state
  forSalePrice: number | null;
  forSaleStatus: string | null;
  daysOnMarket: number | null;

  // Building / market context
  buildingClass: string | null;
  marketName: string | null;
  submarket: string | null;
  submarketCluster: string | null;
  tenancy: string | null;
  percentLeased: number | null;
  vacancyPct: number | null;
  rentPerSfYr: number | null;

  // Tax
  taxYear: number | null;
  taxTotal: number | null;
  taxPerSf: number | null;

  // Service contacts (CoStar's record)
  propertyManagerName: string | null;
  propertyManagerPhone: string | null;
  propertyManagerAddress: string | null;
  salesCompanyName: string | null;
  salesContactName: string | null;
  salesContactPhone: string | null;
  leasingCompanyName: string | null;
  leasingContactName: string | null;
  leasingContactPhone: string | null;

  // Hotel-specific (asset_type=hospitality)
  rooms: number | null;
  hotelBrand: string | null;
  hotelClass: string | null;

  // Geo (for maps + market context queries)
  latitude: number | null;
  longitude: number | null;

  // Signals (from prospector enrichment)
  prospectorSignalFlags: string[];

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

  // Pull base records with the filters applied. Cold inventory (status='prospect')
  // is hidden by default — those live in the Prospector. The user can still pass
  // filters.status='prospect' explicitly if they want to drag a cold property out
  // of cold storage manually.
  let q = sb
    .from("properties")
    .select(
      "id, slug, name, address, city, state, asset_type, status, asking_price, sqft, noi, cap_rate, occupancy_pct, your_role, transaction_type, pipeline_stage, created_at",
    )
    .eq("organization_id", ORG_ID)
    .order("created_at", { ascending: false });

  if (filters.assetType) q = q.eq("asset_type", filters.assetType);
  if (filters.status) {
    q = q.eq("status", filters.status);
  } else {
    q = q.neq("status", "prospect");
  }
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
  const [activityMap, taskMap, overdueTaskMap, hotLeadMap] = await Promise.all([
    fetchLastActivityByProperty(ids),
    fetchOpenTaskCounts(ids),
    fetchOverdueTaskCounts(ids),
    fetchHotLeadCounts(ids),
  ]);

  return props.map((p): PropertyCard => {
    const lastActivityIso = activityMap.get(p.id);
    const daysSinceTouch = lastActivityIso ? daysSince(lastActivityIso) : null;
    const status = (p.status ?? "").toLowerCase();
    const listed = status === "listed" || status === "active";

    const hotLeads = hotLeadMap.get(p.id) ?? 0;
    const openTasks = taskMap.get(p.id) ?? 0;
    const overdueTasks = overdueTaskMap.get(p.id) ?? 0;

    const isHot = hotLeads > 0;
    const isQuiet = listed && daysSinceTouch !== null && daysSinceTouch >= 12;
    const isStale = listed && daysSinceTouch !== null && daysSinceTouch >= 14;
    const isMissingValuation =
      listed && (numOrNull(p.noi) === null || numOrNull(p.cap_rate) === null);

    // Priority score — composite of urgency signals. Tuned so a single hot
    // lead beats a quiet listing, an overdue task beats stale, and "closes
    // this week" (when wired in Phase 4) beats everything.
    let priorityScore = 0;
    priorityScore += hotLeads * 3;
    priorityScore += overdueTasks * 2;
    if (isStale) priorityScore += 2;
    else if (isQuiet) priorityScore += 1;
    if (isMissingValuation) priorityScore += 1;
    if (openTasks > 0 && overdueTasks === 0) priorityScore += 1;

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
      openTasks,
      overdueTasks,
      hotLeads,
      isHot,
      isQuiet,
      isStale,
      isMissingValuation,
      isClosingSoon: false, // wired when deal join lands

      priorityScore,
      nextAction: pickNextAction({
        hotLeads, overdueTasks, openTasks, isStale, isQuiet,
        isMissingValuation, listed, daysSinceTouch,
      }),
    };
  });
}

/** Pick the single most-urgent next action to surface on the card. Order
 * matters: hot leads dominate, then overdue, then stage-staleness, then
 * gentle nudges. Returns null when the asset is calm. */
function pickNextAction(s: {
  hotLeads: number;
  overdueTasks: number;
  openTasks: number;
  isStale: boolean;
  isQuiet: boolean;
  isMissingValuation: boolean;
  listed: boolean;
  daysSinceTouch: number | null;
}): string | null {
  if (s.hotLeads > 0) return `Reply to ${s.hotLeads} hot lead${s.hotLeads === 1 ? "" : "s"}`;
  if (s.overdueTasks > 0) return `Resolve ${s.overdueTasks} overdue task${s.overdueTasks === 1 ? "" : "s"}`;
  if (s.isStale) return "Refresh listing — 14+ days quiet";
  if (s.isQuiet) return "Owner update due";
  if (s.isMissingValuation) return "Run a fresh BOV";
  if (s.openTasks > 0) return `Work ${s.openTasks} open task${s.openTasks === 1 ? "" : "s"}`;
  return null;
}

// ── Detail loader ──────────────────────────────────────────────────────────
export async function loadPropertyDetail(slug: string): Promise<PropertyDetail | null> {
  const sb = createServerSupabase();

  const { data: p } = await sb
    .from("properties")
    .select(`
      id, slug, name, address, city, state, zip, county, apn,
      asset_type, sub_type, status, pipeline_stage, your_role, transaction_type,
      asking_price, lease_rate, sqft, units, acreage, year_built, noi, cap_rate,
      occupancy_pct, price_per_sf,
      headline, description, notes, marketing_notes, highlights, investment_highlights, images,
      om_pdf_url, om_generated_at,
      document_inventory, data_source, created_at,
      parking_spaces, parking_ratio, zoning, total_buildings, number_of_stories,
      crexi_url, crexi_listing_id, loopnet_url, publish_to_website,
      owner_name_raw, owner_type, owner_state, owner_phone, owner_contact_name,
      owner_mailing_address, owner_mailing_city, owner_mailing_state, owner_mailing_zip,
      true_owner_name, true_owner_phone, true_owner_contact_name,
      true_owner_address, true_owner_city, true_owner_state, true_owner_zip,
      recorded_owner_name, recorded_owner_phone, recorded_owner_address,
      mortgage_origination_date, mortgage_maturity_date, mortgage_balance, mortgage_lender,
      loan_interest_rate, loan_interest_rate_type, loan_type, loan_collateral_type, loan_originator,
      last_sale_date, last_sale_price, years_owned, estimated_value, prospector_score,
      for_sale_price, for_sale_status, days_on_market,
      building_class, market_name, submarket, submarket_cluster, tenancy,
      percent_leased, vacancy_pct, rent_per_sf_yr,
      tax_year, tax_total, tax_per_sf,
      property_manager_name, property_manager_phone, property_manager_address,
      sales_company_name, sales_contact_name, sales_contact_phone,
      leasing_company_name, leasing_contact_name, leasing_contact_phone,
      rooms, hotel_brand, hotel_class,
      latitude, longitude,
      prospector_signal_flags
    `)
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
    county: p.county ?? null,
    apn: p.apn ?? null,
    assetType: p.asset_type,
    subType: p.sub_type ?? null,
    status: p.status,
    pipelineStage: p.pipeline_stage,
    yourRole: p.your_role,
    transactionType: p.transaction_type,
    askingPrice: numOrNull(p.asking_price),
    leaseRate: numOrNull(p.lease_rate),
    sqft: p.sqft ?? null,
    units: p.units ?? null,
    acreage: numOrNull(p.acreage),
    yearBuilt: p.year_built ?? null,
    noi: numOrNull(p.noi),
    capRate: numOrNull(p.cap_rate),
    occupancyPct: numOrNull(p.occupancy_pct),
    pricePerSf: numOrNull(p.price_per_sf),

    // Physical attributes
    parkingSpaces: p.parking_spaces ?? null,
    parkingRatio: p.parking_ratio ?? null,
    zoning: p.zoning ?? null,
    totalBuildings: p.total_buildings ?? null,
    numberOfStories: p.number_of_stories ?? null,

    // Marketing copy + assets
    headline: p.headline ?? null,
    description: p.description ?? null,
    notes: p.notes ?? null,
    marketingNotes: p.marketing_notes ?? null,
    highlights: Array.isArray(p.highlights) ? (p.highlights as string[]) : [],
    investmentHighlights: Array.isArray(p.investment_highlights) ? (p.investment_highlights as string[]) : [],
    omPdfUrl: (p.om_pdf_url as string | null) ?? null,
    omGeneratedAt: (p.om_generated_at as string | null) ?? null,
    images: Array.isArray(p.images) ? (p.images as any[]) : [],
    documentInventory: (p.document_inventory ?? []) as DocumentInventoryItem[],
    dataSource: p.data_source ?? null,
    createdAt: p.created_at ?? null,

    // External listing identity
    crexiUrl: p.crexi_url ?? null,
    crexiListingId: p.crexi_listing_id ?? null,
    loopnetUrl: p.loopnet_url ?? null,
    publishToWebsite: p.publish_to_website ?? null,

    // Owner identity
    ownerNameRaw: p.owner_name_raw ?? null,
    ownerType: p.owner_type ?? null,
    ownerState: p.owner_state ?? null,
    ownerPhone: p.owner_phone ?? null,
    ownerContactName: p.owner_contact_name ?? null,
    ownerMailingAddress: p.owner_mailing_address ?? null,
    ownerMailingCity: p.owner_mailing_city ?? null,
    ownerMailingState: p.owner_mailing_state ?? null,
    ownerMailingZip: p.owner_mailing_zip ?? null,
    trueOwnerName: p.true_owner_name ?? null,
    trueOwnerPhone: p.true_owner_phone ?? null,
    trueOwnerContactName: p.true_owner_contact_name ?? null,
    trueOwnerAddress: p.true_owner_address ?? null,
    trueOwnerCity: p.true_owner_city ?? null,
    trueOwnerState: p.true_owner_state ?? null,
    trueOwnerZip: p.true_owner_zip ?? null,
    recordedOwnerName: p.recorded_owner_name ?? null,
    recordedOwnerPhone: p.recorded_owner_phone ?? null,
    recordedOwnerAddress: p.recorded_owner_address ?? null,

    // Loan
    mortgageMaturityDate: p.mortgage_maturity_date ?? null,
    mortgageOriginationDate: p.mortgage_origination_date ?? null,
    mortgageBalance: numOrNull(p.mortgage_balance),
    mortgageLender: p.mortgage_lender ?? null,
    loanInterestRate: numOrNull(p.loan_interest_rate),
    loanInterestRateType: p.loan_interest_rate_type ?? null,
    loanType: p.loan_type ?? null,
    loanCollateralType: p.loan_collateral_type ?? null,
    loanOriginator: p.loan_originator ?? null,

    // Sale history
    lastSaleDate: p.last_sale_date ?? null,
    lastSalePrice: numOrNull(p.last_sale_price),
    yearsOwned: p.years_owned ?? null,
    estimatedValue: numOrNull(p.estimated_value),
    prospectorScore: numOrNull(p.prospector_score),

    // Listing state
    forSalePrice: numOrNull(p.for_sale_price),
    forSaleStatus: p.for_sale_status ?? null,
    daysOnMarket: p.days_on_market ?? null,

    // Building / market
    buildingClass: p.building_class ?? null,
    marketName: p.market_name ?? null,
    submarket: p.submarket ?? null,
    submarketCluster: p.submarket_cluster ?? null,
    tenancy: p.tenancy ?? null,
    percentLeased: numOrNull(p.percent_leased),
    vacancyPct: numOrNull(p.vacancy_pct),
    rentPerSfYr: numOrNull(p.rent_per_sf_yr),

    // Tax
    taxYear: p.tax_year ?? null,
    taxTotal: numOrNull(p.tax_total),
    taxPerSf: numOrNull(p.tax_per_sf),

    // Service contacts
    propertyManagerName: p.property_manager_name ?? null,
    propertyManagerPhone: p.property_manager_phone ?? null,
    propertyManagerAddress: p.property_manager_address ?? null,
    salesCompanyName: p.sales_company_name ?? null,
    salesContactName: p.sales_contact_name ?? null,
    salesContactPhone: p.sales_contact_phone ?? null,
    leasingCompanyName: p.leasing_company_name ?? null,
    leasingContactName: p.leasing_contact_name ?? null,
    leasingContactPhone: p.leasing_contact_phone ?? null,

    // Hotel-specific
    rooms: p.rooms ?? null,
    hotelBrand: p.hotel_brand ?? null,
    hotelClass: p.hotel_class ?? null,

    // Geo
    latitude: numOrNull(p.latitude),
    longitude: numOrNull(p.longitude),

    // Signals
    prospectorSignalFlags: (p.prospector_signal_flags as string[]) ?? [],

    // Connected
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

async function fetchOverdueTaskCounts(ids: string[]): Promise<Map<string, number>> {
  const sb = createServerSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from("tasks")
    .select("property_id")
    .eq("organization_id", ORG_ID)
    .in("property_id", ids)
    .neq("status", "done")
    .lt("due_date", today);
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
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + Math.round(n).toLocaleString();
}
