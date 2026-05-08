import { DocumentsView } from "@/components/cre-os/documents/DocumentsView";
import { loadDocumentsSnapshot } from "@/lib/cre-os/documents-queries";

/**
 * Phase 9.5 — Portfolio-wide document index.
 *
 * The actual upload flow lives on the property workspace's Documents tab
 * (since every doc belongs to a property). This page is the one-stop
 * search/browse across everything: filter by property, search by name,
 * download.
 */
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const snapshot = await loadDocumentsSnapshot();
  return <DocumentsView snapshot={snapshot} />;
}
