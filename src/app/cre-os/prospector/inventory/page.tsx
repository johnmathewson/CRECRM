import { ColdInventoryView } from "@/components/cre-os/prospector/ColdInventoryView";
import { loadColdInventory, loadProspectorFacets } from "@/lib/cre-os/prospector-queries";

export const dynamic = "force-dynamic";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: { q?: string; assetType?: string; county?: string; signalFlag?: string; page?: string };
}) {
  const page = Math.max(0, parseInt(searchParams.page ?? "0") || 0);
  const limit = 50;
  const [inv, facets] = await Promise.all([
    loadColdInventory({
      q: searchParams.q,
      assetType: searchParams.assetType,
      county: searchParams.county,
      signalFlag: searchParams.signalFlag,
      limit,
      offset: page * limit,
    }),
    loadProspectorFacets(),
  ]);
  return <ColdInventoryView inv={inv} facets={facets} page={page} limit={limit} filters={searchParams} />;
}
