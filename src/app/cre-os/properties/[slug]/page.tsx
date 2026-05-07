import { notFound } from "next/navigation";
import { PropertyWorkspace } from "@/components/cre-os/property/PropertyWorkspace";
import { loadPropertyDetail } from "@/lib/cre-os/property-queries";

/**
 * Phase 2 — Property workspace. The most important screen in the product:
 * a property opens into a multi-panel workspace (Overview · Valuation & Comps
 * · Performance · Activity) with an AI summary band, a property-scoped
 * insights rail, and quick-action affordances.
 */
export const dynamic = "force-dynamic";

export default async function PropertyDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const detail = await loadPropertyDetail(params.slug);
  if (!detail) notFound();
  return <PropertyWorkspace p={detail} />;
}
