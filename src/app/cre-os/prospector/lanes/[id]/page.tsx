import { notFound } from "next/navigation";
import { LaneConfiguratorView } from "@/components/cre-os/prospector/LaneConfiguratorView";
import { loadLaneDetail, loadProspectorFacets } from "@/lib/cre-os/prospector-queries";
import { loadAllPersonas } from "@/lib/cre-os/personas-queries";

export const dynamic = "force-dynamic";

export default async function LaneDetailPage({ params }: { params: { id: string } }) {
  const [lane, facets, personas] = await Promise.all([
    loadLaneDetail(params.id),
    loadProspectorFacets(),
    loadAllPersonas(),
  ]);
  if (!lane) notFound();
  return <LaneConfiguratorView lane={lane} facets={facets} personas={personas} />;
}
