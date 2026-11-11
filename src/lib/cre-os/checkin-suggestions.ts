import { PIPELINE_LADDER, normalizeStage, type StageKey } from "@/lib/cre-os/stage-config";

/** Field changes the check-in proposes from one of John's answers. */
export interface CheckinSuggestions {
  note: string | null;
  stage?: StageKey;
  probability_pct?: number;
  expected_close?: string;
  next_step?: string;
  next_step_due?: string;
  close_outcome?: "dead" | "lost" | "won";
  close_reason?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Keep only well-formed suggestions that actually change something. The
 * model's output is a proposal, so anything malformed is dropped rather
 * than shown to John as a one-tap change.
 */
export function sanitizeSuggestions(
  raw: any,
  current: { stage: StageKey; probability_pct: number | null; expected_close: string | null; next_step: string | null; next_step_due: string | null }
): CheckinSuggestions | null {
  if (!raw || typeof raw !== "object") return null;
  const out: CheckinSuggestions = { note: typeof raw.note === "string" ? raw.note.trim().slice(0, 500) || null : null };

  if (typeof raw.stage === "string" && (PIPELINE_LADDER as string[]).includes(raw.stage) && normalizeStage(raw.stage) !== current.stage) {
    out.stage = raw.stage as StageKey;
  }
  const prob = Number(raw.probability_pct);
  if (raw.probability_pct !== null && raw.probability_pct !== undefined && Number.isFinite(prob) && prob >= 0 && prob <= 100 && Math.round(prob) !== Math.round(Number(current.probability_pct ?? -1))) {
    out.probability_pct = Math.round(prob);
  }
  if (typeof raw.expected_close === "string" && DATE.test(raw.expected_close) && raw.expected_close !== current.expected_close) {
    out.expected_close = raw.expected_close;
  }
  if (typeof raw.next_step === "string" && raw.next_step.trim() && raw.next_step.trim() !== current.next_step) {
    out.next_step = raw.next_step.trim().slice(0, 300);
  }
  if (typeof raw.next_step_due === "string" && DATE.test(raw.next_step_due) && raw.next_step_due !== current.next_step_due) {
    out.next_step_due = raw.next_step_due;
  }
  if (raw.close_outcome === "dead" || raw.close_outcome === "lost" || raw.close_outcome === "won") {
    out.close_outcome = raw.close_outcome;
    out.close_reason = typeof raw.close_reason === "string" ? raw.close_reason.slice(0, 300) : null;
  }
  return out;
}

/** True when there's at least one change to offer (the note alone isn't one). */
export function hasChanges(s: CheckinSuggestions | null | undefined): boolean {
  if (!s) return false;
  return Boolean(s.stage || s.probability_pct !== undefined || s.expected_close || s.next_step || s.next_step_due || s.close_outcome);
}
