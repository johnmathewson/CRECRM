/**
 * Property status ↔ deal stage glue.
 *
 * Two parallel concepts coexist in the schema:
 *   • properties.status     — asset lifecycle ("listed", "under_contract", …)
 *   • deal_stages.stage     — sales-process stage ("Lead" → "Closing")
 *
 * They mostly correlate but not always (a property can be listed and still
 * have multiple parallel deals at different stages — e.g. an offer that
 * died and a fresh one). For the *primary* deal tied to a property, this
 * module gives us a sensible default mapping in both directions and lists
 * the values the UI lets you pick.
 *
 * Every value here is allowed by the DB. Anything else gets normalized.
 */

import type { StageKey } from "./stage-config";

// ── Property status enum ───────────────────────────────────────────────────
export type PropertyStatus =
  | "idea"
  | "prospecting"
  | "pitched"
  | "listed"
  | "under_contract"
  | "leased"
  | "sold"
  | "closed"
  | "dead";

/** Order shown in the picker. "dead" hidden — accessed via deal close. */
export const PROPERTY_STATUS_ORDER: PropertyStatus[] = [
  "idea",
  "prospecting",
  "pitched",
  "listed",
  "under_contract",
  "leased",
  "sold",
  "closed",
];

/** Human label + tone for status pill */
export const PROPERTY_STATUS_META: Record<PropertyStatus, {
  label: string;
  tone: "coral" | "teal" | "amber" | "neutral" | "danger";
  /** One-liner for the picker to explain what this means */
  hint: string;
}> = {
  idea:           { label: "Idea",           tone: "neutral", hint: "Just an internal note — not yet a real opportunity." },
  prospecting:    { label: "Prospecting",    tone: "amber",   hint: "Reaching out to the owner / sourcing the listing." },
  pitched:        { label: "Pitched",        tone: "amber",   hint: "BOV delivered, listing agreement in flight." },
  listed:         { label: "Listed",         tone: "coral",   hint: "Live and marketing — taking inquiries." },
  under_contract: { label: "Under Contract", tone: "coral",   hint: "Offer accepted, in DD or financing." },
  leased:         { label: "Leased",         tone: "teal",    hint: "Lease executed (terminal — lease side)." },
  sold:           { label: "Sold",           tone: "teal",    hint: "Sale closed (terminal — sale side)." },
  closed:         { label: "Closed",         tone: "teal",    hint: "Closed (use 'Sold' or 'Leased' if applicable)." },
  dead:           { label: "Dead",           tone: "danger",  hint: "Deal fell out — preserved for history." },
};

// ── Mapping: property status → deal stage ──────────────────────────────────
/**
 * Default deal stage when creating a new deal for a property at this
 * status. Used by:
 *   • POST /api/properties (auto-creating the paired deal)
 *   • Backfill migration (orphaned listings get a deal at the right stage)
 *   • POST /api/properties/[id]/status (advancing the deal in lockstep)
 */
export function defaultStageForStatus(status: PropertyStatus | null | undefined): StageKey {
  switch (status) {
    case "idea":           return "Lead";
    case "prospecting":    return "Prospecting";
    case "pitched":        return "BOV";
    case "listed":         return "Active Listing";
    case "under_contract": return "Due Diligence";
    case "leased":         return "Closing";        // lease execution moment
    case "sold":           return "Closing";        // sale closing moment
    case "closed":         return "Closing";
    case "dead":           return "Lead";
    default:               return "Lead";
  }
}

/**
 * Inverse — when a deal advances to a stage, what should the paired
 * property's status become? We *don't* always overwrite; the API call
 * decides whether to apply this. Returns null if no opinion (i.e. the
 * property's existing status should win).
 */
export function statusForStage(stage: StageKey, transactionType: "sale" | "lease" | null = null): PropertyStatus | null {
  switch (stage) {
    case "Lead":
    case "Prospecting":
      return null; // don't downgrade an already-listed property
    case "Qualifying":
    case "BOV":
      return "pitched";
    case "Pre-listing":
    case "Active Listing":
      return "listed";
    case "LOI":
    case "Underwriting":
    case "Due Diligence":
    case "Financing":
      return "under_contract";
    case "Closing":
    case "Post-close":
    case "Closed":
      return transactionType === "lease" ? "leased" : "sold";
    default:
      return null;
  }
}

/** "Active" = anything that should appear in pipeline kanban. */
export function isActiveStatus(status: PropertyStatus | string | null | undefined): boolean {
  if (!status) return false;
  return ["idea", "prospecting", "pitched", "listed", "under_contract"].includes(status);
}

/** "Terminal" = closed/sold/leased/dead — should NOT be in active kanban. */
export function isTerminalStatus(status: PropertyStatus | string | null | undefined): boolean {
  if (!status) return false;
  return ["sold", "leased", "closed", "dead"].includes(status);
}
