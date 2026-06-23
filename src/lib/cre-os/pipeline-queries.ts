/**
 * CRE OS — Pipeline + deal flow data layer.
 *
 *   loadPipelineBoard(filters) → kanban columns + per-stage rollups
 *   loadDealDetail(id)         → full deal workspace data
 *
 * Two pipelines coexist in `deals`:
 *   • Listings  — sell-side / lease-side (deal_type ∈ {sale, lease})
 *   • Pursuits  — buy-side / acquisition mandates (deal_type='buyer_rep'
 *                 or property_id IS NULL with a client_contact_id)
 */

import { createServerSupabase } from "@/lib/supabase/server";
import {
  ACTIVE_STAGES,
  normalizeStage,
  StageKey,
  stageIndex,
  getStageConfig,
} from "./stage-config";
import {
  daysSince,
  formatDueLabel,
  formatShortDate,
  numOrNull,
  relativeTime,
} from "./time-utils";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Types ──────────────────────────────────────────────────────────────────
export type PipelineSide = "listings" | "pursuits";

export interface DealCardData {
  id: string;
  dealName: string | null;
  dealType: string | null;
  stage: StageKey;
  rawStage: string | null;
  price: number | null;
  probabilityPct: number | null;
  /** Commission as % of price (or of total lease value for lease deals). */
  commissionPct: number | null;
  /** Broker's estimated commission ($). For sale = price × pct; for
   *  lease, broker-entered because it's based on total lease value. */
  estimatedCommission: number | null;
  weightedCommission: number | null;
  expectedClose: string | null;
  enteredAt: string | null;        // when this deal entered current stage
  daysInStage: number | null;
  property: { id: string; name: string; slug: string; city: string | null; state: string | null } | null;
  contact: { id: string; fullName: string; email: string | null } | null;
  /** Open-task count on the property */
  openTasks: number;
  /** "What's stale?" flag — too long in stage given the type */
  stale: boolean;
}

export interface StageColumn {
  stage: StageKey;
  cards: DealCardData[];
  count: number;
  totalValue: number;
  weightedValue: number;
  /** Sum of estimated_commission for deals in this column. */
  totalCommission: number;
  /** Sum of weighted_commission (estimated × probability) for this column. */
  weightedCommission: number;
}

export interface PipelineBoard {
  side: PipelineSide;
  columns: StageColumn[];
  totals: {
    activeDeals: number;
    pipelineValue: number;
    weightedValue: number;
    avgProbability: number | null;
    expectedThisQuarter: number;
    /** Sum of estimated_commission across all open deals on the board. */
    pipelineCommission: number;
    /** Sum of weighted_commission (estimated × probability) across the board. */
    weightedCommission: number;
  };
}

export interface DealDetail {
  id: string;
  dealName: string | null;
  dealType: string | null;
  stage: StageKey;
  rawStage: string | null;
  price: number | null;
  commissionPct: number | null;
  estimatedCommission: number | null;
  probabilityPct: number | null;
  weightedCommission: number | null;
  expectedClose: string | null;
  actualClose: string | null;
  isClosed: boolean;
  isDead: boolean;
  deadReason: string | null;
  notes: string | null;
  createdAt: string | null;
  property: { id: string; name: string; slug: string; address: string | null; city: string | null; state: string | null; askingPrice: number | null; sqft: number | null } | null;
  contact: { id: string; fullName: string; email: string | null; phone: string | null } | null;
  /** Stage history — every row in deal_stages, oldest first */
  stageHistory: Array<{ id: string; stage: string; enteredAt: string | null; exitedAt: string | null; notes: string | null }>;
  daysInCurrentStage: number | null;
  /** Open tasks on the deal or its property */
  tasks: Array<{ id: string; title: string; due: string; tone: "coral" | "amber" | "neutral" }>;
  /** Activity feed (last 20) */
  activity: Array<{ id: string; when: string; subject: string | null; body: string | null; activityType: string | null }>;
}

// ── Loaders ────────────────────────────────────────────────────────────────
export async function loadPipelineBoard(side: PipelineSide = "listings"): Promise<PipelineBoard> {
  const sb = createServerSupabase();

  // Pull all open deals + their property/contact + the most recent active stage entry.
  // is_dead on the EMBEDDED property is pulled too so we can drop deals
  // whose property got archived — those shouldn't surface on the
  // pipeline kanban even if the deal itself wasn't marked dead.
  const { data: deals } = await sb
    .from("deals")
    .select(
      `id, deal_name, deal_type, price, commission_pct, estimated_commission, probability_pct,
       weighted_commission, expected_close, actual_close, is_closed, is_dead, dead_reason,
       property:properties(id, name, slug, city, state, is_dead),
       contact:contacts(id, full_name, email),
       deal_stages(id, stage, entered_at, exited_at)`,
    )
    .eq("organization_id", ORG_ID)
    .eq("is_closed", false)
    .eq("is_dead", false);

  const filtered = (deals ?? []).filter((d: any) => {
    // Skip deals whose property has been archived. Property-less deals
    // (buyer-rep without a target) are unaffected — they have no
    // property to filter on.
    if (d.property && d.property.is_dead === true) return false;
    const isPursuit = d.deal_type === "buyer_rep" || (!d.property && d.contact);
    return side === "pursuits" ? isPursuit : !isPursuit;
  });

  // Resolve open-task counts per property in one batch
  const propertyIds = filtered.map((d: any) => d.property?.id).filter(Boolean);
  const taskMap = await fetchOpenTaskCounts(propertyIds);

  const cards: DealCardData[] = filtered.map((d: any): DealCardData => {
    const activeStageRow = (d.deal_stages ?? []).find((s: any) => !s.exited_at)
                       ?? sortStageHistoryDesc(d.deal_stages)[0]
                       ?? null;
    const stage = normalizeStage(activeStageRow?.stage);
    const enteredAt = activeStageRow?.entered_at ?? null;
    const daysInStage = enteredAt ? daysSince(enteredAt) : null;

    const stale = isStale(stage, daysInStage);

    return {
      id: d.id,
      dealName: d.deal_name,
      dealType: d.deal_type,
      stage,
      rawStage: activeStageRow?.stage ?? null,
      price: numOrNull(d.price),
      probabilityPct: numOrNull(d.probability_pct),
      commissionPct: numOrNull(d.commission_pct),
      estimatedCommission: numOrNull(d.estimated_commission),
      weightedCommission: numOrNull(d.weighted_commission),
      expectedClose: d.expected_close,
      enteredAt,
      daysInStage,
      property: d.property
        ? {
            id: d.property.id,
            name: d.property.name,
            slug: d.property.slug,
            city: d.property.city,
            state: d.property.state,
          }
        : null,
      contact: d.contact ? { id: d.contact.id, fullName: d.contact.full_name, email: d.contact.email } : null,
      openTasks: d.property?.id ? taskMap.get(d.property.id) ?? 0 : 0,
      stale,
    };
  });

  // Bucket into columns; preserve canonical order
  const columns: StageColumn[] = ACTIVE_STAGES.map((stage) => {
    const stageCards = cards
      .filter((c) => c.stage === stage)
      .sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
    const totalValue = stageCards.reduce((s, c) => s + (c.price ?? 0), 0);
    const weightedValue = stageCards.reduce(
      (s, c) => s + (c.price ?? 0) * ((c.probabilityPct ?? getStageConfig(stage).defaultProbability) / 100),
      0,
    );
    const totalCommission = stageCards.reduce((s, c) => s + (c.estimatedCommission ?? 0), 0);
    const weightedCommissionCol = stageCards.reduce(
      (s, c) => s + (c.estimatedCommission ?? 0) * ((c.probabilityPct ?? getStageConfig(stage).defaultProbability) / 100),
      0,
    );
    return {
      stage,
      cards: stageCards,
      count: stageCards.length,
      totalValue,
      weightedValue,
      totalCommission,
      weightedCommission: weightedCommissionCol,
    };
  });

  const activeDeals = cards.length;
  const pipelineValue = cards.reduce((s, c) => s + (c.price ?? 0), 0);
  const weightedValue = cards.reduce(
    (s, c) => s + (c.price ?? 0) * ((c.probabilityPct ?? getStageConfig(c.stage).defaultProbability) / 100),
    0,
  );
  const pipelineCommission = cards.reduce((s, c) => s + (c.estimatedCommission ?? 0), 0);
  const weightedCommissionTotal = cards.reduce(
    (s, c) => s + (c.estimatedCommission ?? 0) * ((c.probabilityPct ?? getStageConfig(c.stage).defaultProbability) / 100),
    0,
  );
  const probSum = cards.reduce((s, c) => s + (c.probabilityPct ?? 0), 0);
  const avgProbability = activeDeals ? probSum / activeDeals : null;

  // Expected to close this quarter — deals with expected_close in next ~90 days
  const ninetyDays = new Date(Date.now() + 90 * 86400000);
  const expectedThisQuarter = cards
    .filter((c) => c.expectedClose && new Date(c.expectedClose) <= ninetyDays)
    .reduce((s, c) => s + (c.price ?? 0), 0);

  return {
    side,
    columns,
    totals: {
      activeDeals,
      pipelineValue,
      weightedValue,
      avgProbability,
      expectedThisQuarter,
      pipelineCommission,
      weightedCommission: weightedCommissionTotal,
    },
  };
}

export async function loadDealDetail(id: string): Promise<DealDetail | null> {
  const sb = createServerSupabase();

  // Cast to `any` because Supabase generates joined relations as arrays even
  // for FK-true 1:1, and we know property/contact resolve to a single row.
  const { data: dRaw } = await sb
    .from("deals")
    .select(
      `id, deal_name, deal_type, price, commission_pct, estimated_commission, probability_pct,
       weighted_commission, expected_close, actual_close, is_closed, is_dead, dead_reason,
       notes, created_at,
       property:properties(id, name, slug, address, city, state, asking_price, sqft),
       contact:contacts(id, full_name, email, phone),
       deal_stages(id, stage, entered_at, exited_at, notes)`,
    )
    .eq("organization_id", ORG_ID)
    .eq("id", id)
    .maybeSingle();
  const d: any = dRaw;

  if (!d) return null;

  const sortedStages = sortStageHistoryAsc(d.deal_stages ?? []);
  const activeStage = sortedStages.find((s: any) => !s.exited_at) ?? sortedStages[sortedStages.length - 1];
  const stage = normalizeStage(activeStage?.stage);
  const enteredAt = activeStage?.entered_at ?? null;
  const daysInCurrentStage = enteredAt ? daysSince(enteredAt) : null;

  // Tasks: pull open tasks on the deal directly + on the linked property
  const taskFilters = [`deal_id.eq.${id}`];
  if (d.property?.id) taskFilters.push(`property_id.eq.${d.property.id}`);
  const { data: taskRows } = await sb
    .from("tasks")
    .select("id, title, due_date, status")
    .eq("organization_id", ORG_ID)
    .neq("status", "done")
    .or(taskFilters.join(","))
    .order("due_date", { ascending: true })
    .limit(15);
  const today = new Date().toISOString().slice(0, 10);
  const tasks = (taskRows ?? []).map((t: any) => ({
    id: t.id,
    title: t.title,
    due: formatDueLabel(t.due_date, today),
    tone: (t.due_date && t.due_date < today
      ? "coral"
      : t.due_date === today
        ? "coral"
        : "neutral") as "coral" | "amber" | "neutral",
  }));

  // Activity: pull from activities table where deal_id = id, fall back to property
  const { data: actRows } = await sb
    .from("activities")
    .select("id, activity_type, subject, body, occurred_at")
    .eq("organization_id", ORG_ID)
    .or(`deal_id.eq.${id}${d.property?.id ? `,property_id.eq.${d.property.id}` : ""}`)
    .order("occurred_at", { ascending: false })
    .limit(20);
  const activity = (actRows ?? []).map((a: any) => ({
    id: a.id,
    when: relativeTime(a.occurred_at),
    subject: a.subject,
    body: a.body,
    activityType: a.activity_type,
  }));

  return {
    id: d.id,
    dealName: d.deal_name,
    dealType: d.deal_type,
    stage,
    rawStage: activeStage?.stage ?? null,
    price: numOrNull(d.price),
    commissionPct: numOrNull(d.commission_pct),
    estimatedCommission: numOrNull(d.estimated_commission),
    probabilityPct: numOrNull(d.probability_pct),
    weightedCommission: numOrNull(d.weighted_commission),
    expectedClose: d.expected_close,
    actualClose: d.actual_close,
    isClosed: !!d.is_closed,
    isDead: !!d.is_dead,
    deadReason: d.dead_reason,
    notes: d.notes,
    createdAt: d.created_at,
    property: d.property
      ? {
          id: d.property.id,
          name: d.property.name,
          slug: d.property.slug,
          address: d.property.address,
          city: d.property.city,
          state: d.property.state,
          askingPrice: numOrNull(d.property.asking_price),
          sqft: d.property.sqft ?? null,
        }
      : null,
    contact: d.contact
      ? { id: d.contact.id, fullName: d.contact.full_name, email: d.contact.email, phone: d.contact.phone }
      : null,
    stageHistory: sortedStages.map((s: any) => ({
      id: s.id,
      stage: s.stage,
      enteredAt: s.entered_at,
      exitedAt: s.exited_at,
      notes: s.notes,
    })),
    daysInCurrentStage,
    tasks,
    activity,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function fetchOpenTaskCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
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

function sortStageHistoryDesc(rows: any[]): any[] {
  return [...(rows ?? [])].sort((a, b) =>
    new Date(b.entered_at ?? 0).getTime() - new Date(a.entered_at ?? 0).getTime(),
  );
}

function sortStageHistoryAsc(rows: any[]): any[] {
  return [...(rows ?? [])].sort((a, b) =>
    new Date(a.entered_at ?? 0).getTime() - new Date(b.entered_at ?? 0).getTime(),
  );
}

/**
 * isStale — whether a deal has been in its current stage longer than the SLA.
 * Empirical defaults; will become configurable per stage when teams join.
 */
function isStale(stage: StageKey, daysInStage: number | null): boolean {
  if (daysInStage === null) return false;
  const sla: Record<StageKey, number> = {
    Lead: 5,
    Prospecting: 7,
    Qualifying: 10,
    BOV: 14,
    "Pre-listing": 14,
    "Active Listing": 90,
    LOI: 7,
    Underwriting: 21,
    "Due Diligence": 30,
    Financing: 30,
    Closing: 14,
    "Post-close": 365,
    Closed: 365,
  };
  return daysInStage > (sla[stage] ?? 14);
}

// Re-export stageIndex so consumers don't need a second import
export { stageIndex };
