import { ProspectorView } from "@/components/cre-os/prospector/ProspectorView";
import { loadProspectorSnapshot } from "@/lib/cre-os/prospector-queries";

/**
 * Prospector — the cold inventory + lane management hub.
 *
 * Sits between Listings (active sell/buy) and Properties (warm pipeline).
 * Cold-only: every property here is at status='prospect' and never appears
 * on the Properties page until a human promotes it.
 */
export const dynamic = "force-dynamic";

export default async function ProspectorPage() {
  const snapshot = await loadProspectorSnapshot();
  return <ProspectorView snapshot={snapshot} />;
}
