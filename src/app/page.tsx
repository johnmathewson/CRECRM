import { redirect } from "next/navigation";

/**
 * Root landing — soft-cutover redirect into CRE OS Command Center.
 *
 * The legacy DashboardContent (with the purple Nav + AiBar) is no longer
 * the primary surface. Anyone who hits the bare domain (or has a
 * bookmark from the old app) lands on /cre-os/ — which is the equivalent
 * Command Center inside the new shell.
 *
 * Reversible: revert this file to restore the legacy dashboard. The
 * components/dashboard-content.tsx, components/nav.tsx, and
 * components/ai-bar.tsx files are untouched — only this entry point
 * changes.
 */
export default function RootPage() {
  redirect("/cre-os");
}
