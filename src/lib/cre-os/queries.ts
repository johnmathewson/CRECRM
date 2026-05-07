/**
 * CRE OS — Command Center data queries.
 *
 * One module, one purpose: load everything the dashboard renders in a single
 * round trip (parallelized). All queries scoped to the hardcoded ORG_ID until
 * we flip multi-tenant; matches the rest of the app.
 */

import { createServerSupabase } from "@/lib/supabase/server";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// The full pipeline ladder we adopted in Phase 0. Order matters — left-to-right
// in the dashboard preview. "Lead" through "Closing" are the active stages;
// closed/dead deals are filtered out of the live count.
export const PIPELINE_STAGES = [
  "Lead",
  "Prospecting",
  "Qualifying",
  "BOV",
  "Pre-listing",
  "Active Listing",
  "LOI",
  "Underwriting",
  "Due Diligence",
  "Financing",
  "Closing",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// ── Types returned to the page ─────────────────────────────────────────────
export interface DashboardKpis {
  pipelineValue: number;
  pipelineDelta: string;
  noi: number;
  noiDelta: string;
  activeListings: number;
  hotLeads: number;
  capRateAvg: number | null;
  tasksDueToday: number;
  tasksOverdue: number;
}

export interface PipelineStageStats {
  stage: PipelineStage | string;
  count: number;
  value: number;
}

export interface CopilotChipData {
  hotLeads: number;
  underwriting: number;
  ownerCheckIns: number; // owner contacts not touched in 12+ days
  closingSoon: number;   // deals with expected_close within 7 days
}

export interface TaskRow {
  id: string;
  title: string;
  context: string;          // "315 W 89th · Merrillville" or contact/deal name
  due: string;              // pre-formatted ("Today" / "Tomorrow" / "May 12")
  tone: "coral" | "amber" | "neutral";
  href: string;             // deep-link target
}

export interface ActivityRow {
  id: string;
  when: string;             // "2m ago"
  who: string;
  did: string;
  target: string;
  href?: string;
}

export interface ReminderRow {
  id: string;
  headline: string;
  caption: string;
  tone: "coral" | "teal" | "amber" | "neutral";
  href?: string;
}

export interface DashboardData {
  kpis: DashboardKpis;
  pipeline: PipelineStageStats[];
  chips: CopilotChipData;
  tasks: TaskRow[];
  activity: ActivityRow[];
  reminders: ReminderRow[];
  copilot: { greeting: string; summary: string };
}

// ── Top-level loader ───────────────────────────────────────────────────────
export async function loadDashboardData(): Promise<DashboardData> {
  // Parallelize everything — none of these depend on each other.
  const [kpis, pipeline, chips, tasks, activity, reminders] = await Promise.all([
    loadKpis(),
    loadPipeline(),
    loadCopilotChips(),
    loadTasks(),
    loadActivity(),
    loadReminders(),
  ]);

  // Greeting — local time aware, no AI for now (Phase 1.6 layers AI summary on top)
  const greeting = greetingForHour(new Date().getHours());
  const summary = buildSummary(chips, tasks, kpis);

  return { kpis, pipeline, chips, tasks, activity, reminders, copilot: { greeting, summary } };
}

// ── KPIs ───────────────────────────────────────────────────────────────────
async function loadKpis(): Promise<DashboardKpis> {
  const sb = createServerSupabase();

  // Pipeline value: open deals only (not closed, not dead)
  const { data: openDeals } = await sb
    .from("deals")
    .select("price")
    .eq("organization_id", ORG_ID)
    .eq("is_closed", false)
    .eq("is_dead", false);
  const pipelineValue = (openDeals ?? []).reduce(
    (s, d: any) => s + (Number(d.price) || 0),
    0,
  );

  // NOI — sum of properties.noi where status is active and noi is set.
  // Strict TTM would need a rent-history aggregation; v1 is in-place NOI.
  const { data: propsForNoi } = await sb
    .from("properties")
    .select("noi, asking_price, cap_rate")
    .eq("organization_id", ORG_ID)
    .not("noi", "is", null);
  const noi = (propsForNoi ?? []).reduce(
    (s, p: any) => s + (Number(p.noi) || 0),
    0,
  );

  // Cap rate — value-weighted average across properties that have both
  let capRateAvg: number | null = null;
  const withCap = (propsForNoi ?? []).filter(
    (p: any) => Number(p.cap_rate) > 0 && Number(p.asking_price) > 0,
  );
  if (withCap.length > 0) {
    const num = withCap.reduce(
      (s: number, p: any) => s + Number(p.cap_rate) * Number(p.asking_price),
      0,
    );
    const den = withCap.reduce((s: number, p: any) => s + Number(p.asking_price), 0);
    capRateAvg = den > 0 ? num / den : null;
  }

  // Active listings — properties marked active or listed and not dead
  const { count: activeListingsCount } = await sb
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .in("status", ["active", "listed"])
    .or("is_dead.is.null,is_dead.eq.false");

  // Hot leads
  const { count: hotLeadsCount } = await sb
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ORG_ID)
    .eq("urgency", "hot")
    .not("status", "in", "(archived,spam,sent,converted)");

  // Tasks today + overdue
  const today = new Date().toISOString().slice(0, 10);
  const { data: dueTasksRaw } = await sb
    .from("tasks")
    .select("id, due_date, status")
    .eq("organization_id", ORG_ID)
    .neq("status", "done")
    .lte("due_date", today);
  const tasksDueToday = (dueTasksRaw ?? []).filter(
    (t: any) => t.due_date === today,
  ).length;
  const tasksOverdue = (dueTasksRaw ?? []).filter(
    (t: any) => t.due_date && t.due_date < today,
  ).length;

  return {
    pipelineValue,
    pipelineDelta: "", // TODO: Phase 1.6 compare to prior period
    noi,
    noiDelta: "",
    activeListings: activeListingsCount ?? 0,
    hotLeads: hotLeadsCount ?? 0,
    capRateAvg,
    tasksDueToday,
    tasksOverdue,
  };
}

// ── Pipeline preview ───────────────────────────────────────────────────────
async function loadPipeline(): Promise<PipelineStageStats[]> {
  const sb = createServerSupabase();

  // Current stage = the deal_stages row with exited_at IS NULL.
  // Pull every active deal_stages row + its parent deal's price.
  const { data: rows } = await sb
    .from("deal_stages")
    .select("stage, deal:deals(price, is_dead, is_closed, organization_id)")
    .is("exited_at", null);

  const buckets = new Map<string, { count: number; value: number }>();
  for (const r of (rows ?? []) as any[]) {
    const deal = r.deal;
    if (!deal || deal.organization_id !== ORG_ID) continue;
    if (deal.is_closed || deal.is_dead) continue;
    const stage = (r.stage ?? "Lead") as string;
    const cur = buckets.get(stage) ?? { count: 0, value: 0 };
    cur.count += 1;
    cur.value += Number(deal.price) || 0;
    buckets.set(stage, cur);
  }

  // Render in the canonical ladder order; include zero-count stages so the
  // dashboard always shows the full pipeline shape.
  return PIPELINE_STAGES.map((stage) => {
    const b = buckets.get(stage) ?? { count: 0, value: 0 };
    return { stage, count: b.count, value: b.value };
  });
}

// ── Copilot chips ──────────────────────────────────────────────────────────
async function loadCopilotChips(): Promise<CopilotChipData> {
  const sb = createServerSupabase();

  const [{ count: hotLeads }, { count: underwriting }, { count: closingSoon }, { count: ownerCheckIns }] =
    await Promise.all([
      sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ORG_ID)
        .eq("urgency", "hot")
        .not("status", "in", "(archived,spam,sent,converted)"),
      sb
        .from("deal_stages")
        .select("id", { count: "exact", head: true })
        .is("exited_at", null)
        .in("stage", ["Underwriting", "Due Diligence"]),
      sb
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ORG_ID)
        .eq("is_closed", false)
        .eq("is_dead", false)
        .not("expected_close", "is", null)
        .lte("expected_close", new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)),
      // Placeholder until we wire `last_touched_at` on contacts: count of
      // contacts marked as owner role with no recent activity.
      sb
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", ORG_ID)
        .eq("contact_type", "owner"),
    ]);

  return {
    hotLeads: hotLeads ?? 0,
    underwriting: underwriting ?? 0,
    ownerCheckIns: ownerCheckIns ?? 0,
    closingSoon: closingSoon ?? 0,
  };
}

// ── Tasks ──────────────────────────────────────────────────────────────────
async function loadTasks(): Promise<TaskRow[]> {
  const sb = createServerSupabase();

  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: tasks } = await sb
    .from("tasks")
    .select(
      "id, title, due_date, due_time, status, property:properties(id, name, address, city), deal:deals(id, deal_name)",
    )
    .eq("organization_id", ORG_ID)
    .neq("status", "done")
    .lte("due_date", in14)
    .order("due_date", { ascending: true })
    .limit(8);

  return (tasks ?? []).map((t: any) => {
    const dueLabel = formatDueLabel(t.due_date, today);
    const tone =
      t.due_date && t.due_date < today ? "coral"
        : t.due_date === today          ? "coral"
        : "neutral";
    const context =
      t.property?.name
        ? `${t.property.name}${t.property.city ? " · " + t.property.city : ""}`
        : t.deal?.deal_name
          ? t.deal.deal_name
          : "—";
    const href = t.property?.id
      ? `/cre-os/properties/${t.property.id}`
      : t.deal?.id
        ? `/cre-os/pipeline?deal=${t.deal.id}`
        : "/cre-os";
    return { id: t.id, title: t.title, context, due: dueLabel, tone, href };
  });
}

// ── Activity ───────────────────────────────────────────────────────────────
async function loadActivity(): Promise<ActivityRow[]> {
  const sb = createServerSupabase();

  const { data: rows } = await sb
    .from("activities")
    .select(
      "id, activity_type, subject, occurred_at, property:properties(name, city), contact:contacts(full_name), deal:deals(deal_name)",
    )
    .eq("organization_id", ORG_ID)
    .order("occurred_at", { ascending: false })
    .limit(8);

  return (rows ?? []).map((r: any) => {
    const target =
      r.property?.name
        ? `${r.property.name}${r.property.city ? " · " + r.property.city : ""}`
        : r.contact?.full_name
          ? r.contact.full_name
          : r.deal?.deal_name
            ? r.deal.deal_name
            : r.subject || "—";
    return {
      id: r.id,
      when: relativeTime(r.occurred_at),
      who: "You", // single-user; flip when multi-user lands
      did: humanizeActivity(r.activity_type),
      target,
    };
  });
}

// ── Reminders (right-rail bottom section) ──────────────────────────────────
async function loadReminders(): Promise<ReminderRow[]> {
  // Lease expirations — placeholder (need lease/lease_end fields on a leases table)
  // Debt maturity — placeholder (need debt schedule)
  // For v1, derive from properties that have lease_rate + a "lease_end" via intake_units when available.
  // Returning empty for now keeps the rail honest until real signals exist.
  return [];
}

// ── Helpers ────────────────────────────────────────────────────────────────
function greetingForHour(h: number): string {
  if (h < 5) return "Working late, John.";
  if (h < 12) return "Good morning, John.";
  if (h < 17) return "Good afternoon, John.";
  return "Good evening, John.";
}

function buildSummary(chips: CopilotChipData, tasks: TaskRow[], kpis: DashboardKpis): string {
  const bits: string[] = [];
  if (chips.hotLeads > 0) bits.push(`${chips.hotLeads} hot lead${chips.hotLeads === 1 ? "" : "s"} need follow-up`);
  if (kpis.tasksOverdue > 0) bits.push(`${kpis.tasksOverdue} overdue task${kpis.tasksOverdue === 1 ? "" : "s"}`);
  if (chips.closingSoon > 0) bits.push(`${chips.closingSoon} deal${chips.closingSoon === 1 ? "" : "s"} closing this week`);
  if (chips.underwriting > 0) bits.push(`${chips.underwriting} in underwriting`);
  return bits.length ? bits.join(" · ") : "Pipeline looks calm. Good day to source new opportunities.";
}

function formatDueLabel(dateStr: string | null, today: string): string {
  if (!dateStr) return "—";
  if (dateStr === today) return "Today";
  // tomorrow
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === tomorrow) return "Tomorrow";
  // overdue
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
    case "email":          return "emailed";
    case "call":           return "called";
    case "meeting":        return "met with";
    case "tour":           return "toured";
    case "note":           return "noted";
    case "stage_change":   return "advanced stage on";
    case "valuation_run":  return "ran a valuation on";
    case "comp_import":    return "imported comps for";
    case "doc_upload":     return "uploaded a document for";
    case "task_complete":  return "completed a task on";
    default:               return "updated";
  }
}
