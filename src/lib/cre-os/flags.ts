/**
 * CRE OS rebuild — feature flag helpers.
 *
 * Old screens keep working. New screens live under `/cre-os/*`. Routing checks
 * `isCreOsEnabled()` before redirecting `/` to the new Command Center.
 *
 * Phases ship as the flag flips per route (or globally via env var).
 */

export const CRE_OS_BETA_ENV = "NEXT_PUBLIC_CRE_OS_BETA";

/**
 * Server / client agnostic check. Reads from process.env which is inlined at
 * build time for `NEXT_PUBLIC_*` vars, so this works on both edges.
 */
export function isCreOsEnabled(): boolean {
  return process.env[CRE_OS_BETA_ENV] === "1";
}

/**
 * Phase-level flags. Lets us roll out one new screen at a time during the
 * rebuild without touching unrelated code paths. Default false until the
 * phase is shipped and merged.
 */
export const PHASE_FLAGS = {
  /** Phase 1 — new Command Center dashboard at /cre-os/ */
  commandCenter: true,
  /** Phase 2 — new Property Workspace at /cre-os/properties/[id] */
  propertyWorkspace: false,
  /** Phase 3 — new Pipeline at /cre-os/pipeline */
  pipeline: false,
  /** Phase 4 — new Relationships (contacts + pursuits) at /cre-os/relationships */
  relationships: false,
  /** Phase 5 — Inbox Lead Command at /cre-os/inbox */
  inbox: false,
  /** Phase 6 — Market Intelligence at /cre-os/market */
  marketIntel: false,
  /** Phase 7 — Owner / Investor Portals (lives on stewardshipcre.com via magic link) */
  ownerPortals: false,
} as const;

export type PhaseKey = keyof typeof PHASE_FLAGS;

export function isPhaseEnabled(phase: PhaseKey): boolean {
  return PHASE_FLAGS[phase];
}
