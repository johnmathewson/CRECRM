import { ProspectorInboxView } from "@/components/cre-os/prospector/ProspectorInboxView";
import {
  loadProspectorInbox,
  type InboxFilters,
} from "@/lib/cre-os/prospector-inbox-queries";
import { loadLaneList } from "@/lib/cre-os/prospector-queries";

/**
 * Prospector Inbox — every outbound touch + every reply in one stream.
 * Distinct from /cre-os/inbox (which is unsolicited inbound leads from
 * the marketing site).
 */
export const dynamic = "force-dynamic";

export default async function ProspectorInboxPage({
  searchParams,
}: {
  searchParams: { status?: string; lane?: string; q?: string };
}) {
  const filters: InboxFilters = {
    status: (searchParams.status as InboxFilters["status"]) ?? "all",
    laneId: searchParams.lane,
    q: searchParams.q,
    limit: 100,
  };
  const [snapshot, lanes] = await Promise.all([
    loadProspectorInbox(filters),
    loadLaneList(),
  ]);
  return (
    <ProspectorInboxView
      snapshot={snapshot}
      lanes={lanes}
      activeFilters={filters}
    />
  );
}
