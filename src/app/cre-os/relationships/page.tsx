import { RelationshipListView } from "@/components/cre-os/relationship/RelationshipListView";
import { loadRelationshipList } from "@/lib/cre-os/relationship-queries";

/**
 * Phase 4 — Relationships index. Loads contacts with computed warmth, signal
 * counts, and priority scores; client renders the command surface.
 */
export const dynamic = "force-dynamic";

export default async function RelationshipsPage() {
  const contacts = await loadRelationshipList();
  return <RelationshipListView contacts={contacts} />;
}
