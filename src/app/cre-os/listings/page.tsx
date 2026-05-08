import { ListingsView } from "@/components/cre-os/listings/ListingsView";
import { loadListingsSnapshot } from "@/lib/cre-os/listings-queries";

/**
 * Phase 9.5 — Listings command surface.
 *
 * Distinct from Properties (full inventory) and Pipeline (deals by stage).
 * Answers the operational question every Monday: "what's actively on
 * market or being chased right now, and how is it pulling?"
 *
 * Sell-side: properties at status in (listed, under_contract).
 * Buy-side: active buyer-rep deals with a property attached.
 */
export const dynamic = "force-dynamic";

export default async function ListingsPage() {
  const snapshot = await loadListingsSnapshot();
  return <ListingsView snapshot={snapshot} />;
}
