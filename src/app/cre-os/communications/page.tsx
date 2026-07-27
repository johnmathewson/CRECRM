import { CommunicationsView } from "@/components/cre-os/communications/CommunicationsView";
import {
  loadCommunicationsDashboard,
  type CommsFilters,
  type TouchKind,
} from "@/lib/cre-os/communications-queries";

/**
 * Communication log — every email in one filterable place.
 *
 * All filter state lives in the URL so a filtered view is shareable and
 * survives refresh. Server reads the params, loads the matching slice,
 * and hands the client a fully-resolved snapshot.
 */
export const dynamic = "force-dynamic";

const VALID_KINDS: TouchKind[] = [
  "ai_followup",
  "campaign",
  "auto_ack",
  "manual",
  "internal",
];

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams?: {
    q?: string;
    property?: string;
    kind?: string;
    direction?: string;
    since?: string;
    until?: string;
  };
}) {
  const kindParam = searchParams?.kind;
  const dirParam = searchParams?.direction;

  const filters: CommsFilters = {
    q: searchParams?.q,
    propertyId: searchParams?.property,
    // Only trust params that match the known vocabulary — a bad value in
    // the URL should fall back to "all", not produce an empty page.
    touchKind:
      kindParam && VALID_KINDS.includes(kindParam as TouchKind)
        ? (kindParam as TouchKind)
        : "all",
    direction:
      dirParam === "inbound" || dirParam === "outbound" ? dirParam : "all",
    since: searchParams?.since,
    until: searchParams?.until,
  };

  const snapshot = await loadCommunicationsDashboard(filters);
  return <CommunicationsView snapshot={snapshot} />;
}
