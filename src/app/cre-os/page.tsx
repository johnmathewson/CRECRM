import { CommandCenterView } from "@/components/cre-os/CommandCenterView";
import { loadDashboardData } from "@/lib/cre-os/queries";
import { loadInboxList } from "@/lib/cre-os/inbox-queries";

/**
 * Phase 1.5 — Command Center, data-wired.
 *
 * Server component: pulls the dashboard snapshot AND the inbox list in
 * parallel. The inbox list feeds the "Do This Now" ranked action queue,
 * whose rows open the ContactDrawer in-context. Each render is a fresh DB
 * read (no caching yet).
 */
export const dynamic = "force-dynamic"; // ensure each load reflects current DB state

export default async function CommandCenter() {
  const [data, leads] = await Promise.all([loadDashboardData(), loadInboxList()]);
  return <CommandCenterView data={data} doThisNow={leads} />;
}
