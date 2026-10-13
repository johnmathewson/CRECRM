import { TodayBriefView } from "@/components/cre-os/today/TodayBriefView";
import { loadLatestBrief } from "@/lib/cre-os/brief-queries";

/**
 * /cre-os/today/brief — Steward's full morning brief inside the CRM, with
 * regenerate + feedback. /cre-os/today shows its lede above the queue.
 */
export const dynamic = "force-dynamic";

export default async function TodayBriefPage() {
  const brief = await loadLatestBrief();
  return <TodayBriefView brief={brief} />;
}
