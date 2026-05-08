import { redirect } from "next/navigation";

/**
 * Soft-cutover redirect: legacy /properties → /cre-os/properties.
 *
 * The CRE OS Properties command surface is now the canonical home for
 * property browsing, filtering, and add-property workflow. The legacy
 * properties-content (with the purple Nav, side-panel selector, and
 * AddListingWizard) is preserved in src/components/ but no longer
 * rendered.
 *
 * Reversible: revert this file to restore the legacy view.
 */
export default function LegacyPropertiesPage() {
  redirect("/cre-os/properties");
}
