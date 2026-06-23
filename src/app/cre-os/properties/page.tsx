import { PropertyListView } from "@/components/cre-os/property/PropertyListView";
import { loadPropertyList } from "@/lib/cre-os/property-queries";

/**
 * Phase 2 — Property index. Server-renders the asset inventory with signal
 * counts pre-aggregated; client filters the in-memory list.
 *
 * URL flag: ?archived=1 → renders ONLY the archived inventory (is_dead=true).
 * Default omits archived entirely. The link to the archived view lives in
 * the list-view header.
 */
export const dynamic = "force-dynamic";

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams?: { archived?: string };
}) {
  const showArchived = searchParams?.archived === "1" || searchParams?.archived === "true";
  const properties = await loadPropertyList({ archived: showArchived });
  return <PropertyListView properties={properties} archivedView={showArchived} />;
}
