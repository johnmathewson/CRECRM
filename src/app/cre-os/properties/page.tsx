import { PropertyListView } from "@/components/cre-os/property/PropertyListView";
import { loadPropertyList } from "@/lib/cre-os/property-queries";

/**
 * Phase 2 — Property index. Server-renders the asset inventory with signal
 * counts pre-aggregated; client filters the in-memory list.
 */
export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const properties = await loadPropertyList();
  return <PropertyListView properties={properties} />;
}
