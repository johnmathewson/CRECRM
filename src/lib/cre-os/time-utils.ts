/**
 * CRE OS — shared time helpers.
 *
 * Single source for the formatting functions every query module reaches for.
 * Was duplicated across queries.ts / property-queries.ts / pipeline-queries.ts;
 * consolidated to keep behavior identical everywhere.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole days between an ISO timestamp and now (floor). Negative if `iso` is in the future. */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/** "May 12" — short label without a year. */
export function formatShortDate(s: string | null | undefined): string {
  if (!s) return "—";
  const [, m, d] = s.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/**
 * "Today" / "Tomorrow" / "Overdue · May 4" / "May 12".
 * Returns "—" when no date provided.
 */
export function formatDueLabel(dateStr: string | null | undefined, today?: string): string {
  if (!dateStr) return "—";
  const ref = today ?? new Date().toISOString().slice(0, 10);
  if (dateStr === ref) return "Today";
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (dateStr === tomorrow) return "Tomorrow";
  if (dateStr < ref) return `Overdue · ${formatShortDate(dateStr)}`;
  return formatShortDate(dateStr);
}

/** "just now" / "5m ago" / "2h ago" / "3d ago" / older → short date. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatShortDate(new Date(t).toISOString().slice(0, 10));
}

/**
 * Map an `activities.activity_type` value to a human verb phrase.
 * "stage_change" → "advanced stage"
 * "valuation_run" → "ran a valuation on"
 */
export function humanizeActivity(t: string | null | undefined): string {
  switch ((t ?? "").toLowerCase()) {
    case "email":         return "emailed";
    case "call":          return "called";
    case "meeting":       return "met with";
    case "tour":          return "toured";
    case "note":          return "noted";
    case "stage_change":  return "advanced stage";
    case "valuation_run": return "ran a valuation on";
    case "comp_import":   return "imported comps for";
    case "doc_upload":    return "uploaded a document for";
    case "task_complete": return "completed a task on";
    default:              return "updated";
  }
}

/** Nullable-numeric coercion — returns a finite number or null. */
export function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
