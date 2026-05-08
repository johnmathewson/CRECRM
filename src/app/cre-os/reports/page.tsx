import { ReportsView } from "@/components/cre-os/reports/ReportsView";
import { loadReportSnapshot } from "@/lib/cre-os/report-queries";

/**
 * Phase 9 — Reports & analytics command surface.
 *
 * Answers the recurring questions every broker asks themselves on a
 * Sunday night:
 *   • What's my pipeline worth right now?
 *   • What's expected to close this quarter?
 *   • How am I tracking on volume YTD?
 *   • Where are my leads coming from?
 *   • Which listings are pulling, which need attention?
 *
 * All aggregations server-side; the view is pure presentation.
 */
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const snapshot = await loadReportSnapshot();
  return <ReportsView snapshot={snapshot} />;
}
