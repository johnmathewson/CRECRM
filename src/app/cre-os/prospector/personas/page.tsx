/**
 * /cre-os/prospector/personas
 *
 * Lists all of the Prospector's editable personas. Each persona is a
 * workflow-type "way of speaking" — one per archetype. Edits made here
 * affect every future AI draft using that persona, across all current
 * and future lanes and listings.
 */

import { loadAllPersonas } from "@/lib/cre-os/personas-queries";
import { PersonasListView } from "@/components/cre-os/prospector/PersonasListView";

export const dynamic = "force-dynamic";

export default async function PersonasListPage() {
  const personas = await loadAllPersonas();
  return <PersonasListView personas={personas} />;
}
