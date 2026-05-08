import { redirect } from "next/navigation";

/** Soft-cutover redirect: legacy /settings/integrations → /cre-os/settings. */
export default function LegacySettingsIntegrationsPage() {
  redirect("/cre-os/settings");
}
