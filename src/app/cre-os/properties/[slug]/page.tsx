import { notFound } from "next/navigation";
import { PropertyWorkspace } from "@/components/cre-os/property/PropertyWorkspace";
import { loadPropertyDetail } from "@/lib/cre-os/property-queries";
import { loadCommunicationsForProperty } from "@/lib/cre-os/communications-queries";

/**
 * Phase 2 — Property workspace. Loads detail + threaded communications in
 * parallel. Workspace tabs: Overview / Valuation & Comps / Communications /
 * Performance / Activity.
 */
export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const detail = await loadPropertyDetail(params.slug);
  if (!detail) notFound();
  const threads = await loadCommunicationsForProperty(detail.id);
  return <PropertyWorkspace p={detail} threads={threads} />;
}
