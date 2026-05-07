import { notFound } from "next/navigation";
import { PropertyWorkspace } from "@/components/cre-os/property/PropertyWorkspace";
import { loadPropertyDetail } from "@/lib/cre-os/property-queries";
import { loadCommunicationsForProperty } from "@/lib/cre-os/communications-queries";
import { loadListingPerformance } from "@/lib/cre-os/listing-perf-queries";

/**
 * Phase 2 + 4 + 6 — Property workspace. Loads detail + threaded
 * communications + listing performance in parallel. Workspace tabs:
 * Overview / Valuation & Comps / Communications / Performance / Activity.
 */
export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const detail = await loadPropertyDetail(params.slug);
  if (!detail) notFound();
  const [threads, perf] = await Promise.all([
    loadCommunicationsForProperty(detail.id),
    loadListingPerformance(detail.id),
  ]);
  return <PropertyWorkspace p={detail} threads={threads} perf={perf} />;
}
