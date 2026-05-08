import { unstable_noStore as noStore } from "next/cache";
import { loadReportSnapshot } from "@/lib/cre-os/report-queries";
import { ReportsPrintView } from "./ReportsPrintView";

/**
 * Branded reports executive summary, print-optimized.
 *
 * Lives at /print/reports (outside /cre-os/) so it inherits the print
 * layout — no app shell, no viewport lock, scrolls naturally on the body.
 * The Reports page's "Export PDF" button opens this in a new tab; user
 * clicks "Print or save as PDF" in the toolbar when ready.
 *
 * Server-renders with noStore() so the snapshot is always fresh.
 */
export const dynamic = "force-dynamic";

export default async function ReportsPrintPage() {
  noStore();
  const snapshot = await loadReportSnapshot();
  return <ReportsPrintView snapshot={snapshot} />;
}
