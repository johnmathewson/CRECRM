import { notFound } from "next/navigation";
import { PropertyWorkspace } from "@/components/cre-os/property/PropertyWorkspace";
import { loadPropertyDetail } from "@/lib/cre-os/property-queries";
import { loadCommunicationsForProperty } from "@/lib/cre-os/communications-queries";
import { loadListingPerformance } from "@/lib/cre-os/listing-perf-queries";
import { loadPropertyLeads } from "@/lib/cre-os/property-leads-queries";

export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const detail = await loadPropertyDetail(params.slug);
  if (!detail) notFound();
  const [threads, perf, leads] = await Promise.all([
    loadCommunicationsForProperty(detail.id),
    loadListingPerformance(detail.id),
    loadPropertyLeads(detail.id),
  ]);
  return <PropertyWorkspace p={detail} threads={threads} perf={perf} leads={leads} />;
}
