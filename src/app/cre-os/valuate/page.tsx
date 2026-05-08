import { ValuateView } from "@/components/cre-os/valuate/ValuateView";
import { loadValuateContext } from "@/lib/cre-os/valuate-queries";

/**
 * Phase 9 — Valuation tool inside the CRE OS app shell.
 *
 * The legacy /valuate route still works for direct access (and for any
 * external link that depends on it), but the Intelligence sidebar now
 * points here so the BOV experience matches the rest of the platform —
 * dark theme, sidebar/topbar/rail, brand-consistent typography.
 *
 * This page is a thin wrapper. The 1,272-line ValuateContent client
 * component does all the heavy lifting (rent roll parsing, OM upload,
 * three-approach BOV, save-as-property/save-and-add-to-deals); we just
 * surround it with the shell and a context-aware insights rail.
 */
export const dynamic = "force-dynamic";

export default async function ValuatePage() {
  const context = await loadValuateContext();
  return <ValuateView context={context} />;
}
