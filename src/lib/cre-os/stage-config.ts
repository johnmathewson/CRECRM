/**
 * CRE OS — canonical stage configuration.
 *
 * The long ladder we adopted in Phase 0. Each stage carries the structural
 * behavior the pipeline should "tighten around": default probability, required
 * fields, document checklist, recommended next actions, common risks. The
 * pipeline kanban + deal workspace render directly off this config.
 *
 * Old DB stage values ("Listing", "Under Contract") are mapped to canonical
 * stages by normalizeStage() so the legacy data appears in the right column
 * without a destructive migration.
 */

export type StageKey =
  | "Lead"
  | "Prospecting"
  | "Qualifying"
  | "BOV"
  | "Pre-listing"
  | "Active Listing"
  | "LOI"
  | "Underwriting"
  | "Due Diligence"
  | "Financing"
  | "Closing"
  | "Post-close"
  | "Closed";

export const PIPELINE_LADDER: StageKey[] = [
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
];

/** Stages displayed in the active kanban (Closed/Post-close live in a separate view) */
export const ACTIVE_STAGES = PIPELINE_LADDER;

export interface StageConfig {
  key: StageKey;
  /** What the broker calls this stage */
  label: string;
  /** One-line summary of what's true in this stage */
  description: string;
  /** Default probability assumption — drives weighted commission forecast */
  defaultProbability: number;
  /** Color tone for headers / chips */
  tone: "neutral" | "coral" | "amber" | "teal";
  /** Field names required to advance from this stage */
  requiredFields: string[];
  /** Documents that should exist by the end of this stage */
  docChecklist: string[];
  /** Suggested next actions while in this stage */
  recommendedActions: string[];
  /** What commonly goes sideways here */
  commonRisks: string[];
}

const CONFIG: Record<StageKey, StageConfig> = {
  Lead: {
    key: "Lead",
    label: "Lead",
    description: "Inbound interest or sourced opportunity, not yet qualified.",
    defaultProbability: 5,
    tone: "neutral",
    requiredFields: ["address or property", "primary contact"],
    docChecklist: [],
    recommendedActions: [
      "Verify the contact and decision-maker",
      "Confirm property details and ownership",
      "Set follow-up if no immediate response",
    ],
    commonRisks: ["Bad contact data", "Tire-kicker without authority"],
  },
  Prospecting: {
    key: "Prospecting",
    label: "Prospecting",
    description: "Active outreach to confirm interest and timing.",
    defaultProbability: 10,
    tone: "neutral",
    requiredFields: ["contact info", "rough timing", "rough motivation"],
    docChecklist: ["Initial pitch deck"],
    recommendedActions: [
      "Send the intro pitch / position",
      "Schedule discovery call",
      "Map decision-makers",
    ],
    commonRisks: ["Owner not actually in market", "Unrealistic price expectations"],
  },
  Qualifying: {
    key: "Qualifying",
    label: "Qualifying",
    description: "Confirming motivation, timing, decision authority, financial fit.",
    defaultProbability: 20,
    tone: "neutral",
    requiredFields: ["motivation", "timeline", "decision authority", "approximate price"],
    docChecklist: ["NDA / CA executed"],
    recommendedActions: [
      "Run discovery call",
      "Get NDA signed",
      "Validate financial qualification",
    ],
    commonRisks: ["Unauthorized contact", "Financing not real"],
  },
  BOV: {
    key: "BOV",
    label: "BOV",
    description: "Broker opinion of value in progress — comp work, narrative.",
    defaultProbability: 30,
    tone: "amber",
    requiredFields: ["asset details", "comps pulled", "draft value range"],
    docChecklist: ["Comp set", "Draft BOV", "Rent roll (if applicable)"],
    recommendedActions: [
      "Run /valuate against the asset",
      "Validate cap-rate assumptions vs submarket",
      "Schedule BOV review with owner",
    ],
    commonRisks: ["Cap-rate divergence from comps", "Owner overestimates value"],
  },
  "Pre-listing": {
    key: "Pre-listing",
    label: "Pre-listing",
    description: "Listing agreement in motion, OM in production.",
    defaultProbability: 50,
    tone: "amber",
    requiredFields: ["listing agreement", "asking price", "marketing budget"],
    docChecklist: ["Listing agreement (signed)", "OM draft", "Photo / video assets"],
    recommendedActions: [
      "Finalize OM",
      "Set marketing budget and channels",
      "Sign listing agreement",
    ],
    commonRisks: ["OM photos not ready", "Marketing budget undefined"],
  },
  "Active Listing": {
    key: "Active Listing",
    label: "Active Listing",
    description: "Live on market, syndicated, taking inquiries.",
    defaultProbability: 60,
    tone: "coral",
    requiredFields: ["asking price", "syndication channels", "OM"],
    docChecklist: ["OM published", "CREXi / LoopNet sync confirmed", "NDAs file"],
    recommendedActions: [
      "Triage inquiries within 60 minutes",
      "Weekly owner update with traffic + leads",
      "Monitor source-platform conversion",
    ],
    commonRisks: ["Stale listing (no inquiries 14+ days)", "Price-conversion gap"],
  },
  LOI: {
    key: "LOI",
    label: "LOI",
    description: "Buyer LOI received or executed — commercial terms in motion.",
    defaultProbability: 70,
    tone: "coral",
    requiredFields: ["offer price", "deposit", "diligence period", "closing date"],
    docChecklist: ["LOI", "Proof of funds", "Buyer financial package"],
    recommendedActions: [
      "Owner review meeting on LOI terms",
      "Counter-offer if needed",
      "Confirm buyer's lender and deposit terms",
    ],
    commonRisks: ["Soft proof of funds", "Asymmetric deposit", "Unrealistic DD timeline"],
  },
  Underwriting: {
    key: "Underwriting",
    label: "Underwriting",
    description: "Buyer / lender underwriting the deal.",
    defaultProbability: 75,
    tone: "amber",
    requiredFields: ["lender name", "loan terms", "estoppel status"],
    docChecklist: ["T-12 / T-3", "Rent roll certified", "Capex schedule", "Estoppels requested"],
    recommendedActions: [
      "Provide T-12 and rent roll to underwriter",
      "Initiate estoppel collection",
      "Confirm DSCR and LTV assumptions",
    ],
    commonRisks: ["Appraisal short", "Tenant estoppel discrepancies"],
  },
  "Due Diligence": {
    key: "Due Diligence",
    label: "Due Diligence",
    description: "Phase I, title, survey, inspections, financial true-up.",
    defaultProbability: 80,
    tone: "amber",
    requiredFields: ["DD start date", "DD end date", "title status", "phase I status"],
    docChecklist: ["Phase I ESA", "Title commitment", "Survey", "Inspection report", "Lease abstracts"],
    recommendedActions: [
      "Track DD calendar — extension threshold",
      "Resolve title exceptions early",
      "Coordinate access for inspections",
    ],
    commonRisks: ["Phase I findings", "Survey discrepancies", "Buyer cold feet"],
  },
  Financing: {
    key: "Financing",
    label: "Financing",
    description: "Loan commitment in process or issued, rate-lock pending.",
    defaultProbability: 85,
    tone: "amber",
    requiredFields: ["lender", "rate", "term", "rate-lock date"],
    docChecklist: ["Loan commitment letter", "Rate lock confirmation"],
    recommendedActions: [
      "Confirm rate lock",
      "Track loan condition list",
      "Coordinate with closing attorney",
    ],
    commonRisks: ["Rate spike", "Conditions not satisfied", "Lender timeline drift"],
  },
  Closing: {
    key: "Closing",
    label: "Closing",
    description: "Final week — closing statement, wire instructions, signatures.",
    defaultProbability: 95,
    tone: "teal",
    requiredFields: ["closing date", "settlement statement", "wire instructions"],
    docChecklist: ["HUD / settlement statement", "Wire instructions verified", "Deed", "Bill of sale"],
    recommendedActions: [
      "Verify wire instructions out-of-band",
      "Pre-walkthrough",
      "Confirm tenant notification letters",
    ],
    commonRisks: ["Wire fraud", "Last-minute funding gaps", "Tenant transition issues"],
  },
  "Post-close": {
    key: "Post-close",
    label: "Post-close",
    description: "Closed — nurture, referrals, post-close commitments.",
    defaultProbability: 100,
    tone: "teal",
    requiredFields: [],
    docChecklist: ["Closing binder", "Commission statement"],
    recommendedActions: [
      "Send thank-you / Google review request",
      "Schedule 30/60/90-day check-ins",
      "Log lessons learned",
    ],
    commonRisks: ["Referral promise dropped"],
  },
  Closed: {
    key: "Closed",
    label: "Closed",
    description: "Terminal — deal completed.",
    defaultProbability: 100,
    tone: "teal",
    requiredFields: [],
    docChecklist: [],
    recommendedActions: ["Move to Post-close to nurture"],
    commonRisks: [],
  },
};

export function getStageConfig(key: string | null | undefined): StageConfig {
  const k = normalizeStage(key);
  return CONFIG[k];
}

/** Map any DB stage value (legacy or canonical) to the canonical ladder. */
export function normalizeStage(raw: string | null | undefined): StageKey {
  if (!raw) return "Lead";
  const v = raw.trim();
  // Direct hit
  if (v in CONFIG) return v as StageKey;
  // Legacy short-ladder values
  switch (v.toLowerCase()) {
    case "listing":
      return "Active Listing";
    case "under contract":
      return "Due Diligence";
    case "due_diligence":
    case "dd":
      return "Due Diligence";
    case "post close":
    case "post_close":
      return "Post-close";
    default:
      return "Lead";
  }
}

/** Derived helper: stage index in the ladder (0-based). Closed/Post-close return -1 (terminal). */
export function stageIndex(key: string | null | undefined): number {
  const k = normalizeStage(key);
  if (k === "Closed" || k === "Post-close") return -1;
  return PIPELINE_LADDER.indexOf(k);
}
