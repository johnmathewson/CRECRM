import { PortalsView } from "@/components/cre-os/portals/PortalsView";
import { loadPortalSnapshot, loadPortalCandidates } from "@/lib/cre-os/portal-queries";

/**
 * Phase 7 — Owner & investor portals admin surface. Loads active magic
 * links plus the property/contact pickers the create dialog needs in
 * parallel, hands them to the client view.
 *
 * The actual dashboard the recipient sees lives on stewardshipcre.com;
 * this is the access-control / "who can see what" panel.
 */
export const dynamic = "force-dynamic";

export default async function PortalsPage() {
  const [snapshot, candidates] = await Promise.all([
    loadPortalSnapshot(),
    loadPortalCandidates(),
  ]);
  return <PortalsView snapshot={snapshot} candidates={candidates} />;
}
