import { SettingsView } from "@/components/cre-os/settings/SettingsView";

/**
 * Cutover gap #5 — settings & integrations inside CRE OS.
 *
 * Two real things in here today:
 *   • Gmail OAuth — connection status, last poll, force-poll, disconnect
 *   • Chrome extension API keys — generate / revoke
 *
 * Both wrap existing API endpoints (/api/integrations/google/*,
 * /api/extension/api-keys/*) — no new server logic, just a brand-
 * consistent home for the controls so the broker doesn't have to
 * jump back to legacy /settings/integrations.
 */
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsView />;
}
