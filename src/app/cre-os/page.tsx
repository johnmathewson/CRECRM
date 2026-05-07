import { CommandCenterView } from "@/components/cre-os/CommandCenterView";
import { loadDashboardData } from "@/lib/cre-os/queries";

/**
 * Phase 1.5 — Command Center, data-wired.
 *
 * Server component: pulls KPIs, pipeline, chips, tasks, activity, and reminders
 * in parallel from Supabase, then hands the snapshot to a client view for
 * interaction. Each render is a fresh dashboard read (no caching yet — Phase
 * 1.6 layers in 60-second SWR + a Claude Haiku-generated AI summary line).
 */
export const dynamic = "force-dynamic"; // ensure each load reflects current DB state

export default async function CommandCenter() {
  const data = await loadDashboardData();
  return <CommandCenterView data={data} />;
}
