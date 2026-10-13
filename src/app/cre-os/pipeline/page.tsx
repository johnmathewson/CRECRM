import { PipelineView } from "@/components/cre-os/pipeline/PipelineView";
import { loadPipelineBoard } from "@/lib/cre-os/pipeline-queries";
import { loadScoreboard } from "@/lib/cre-os/scoreboard-queries";
import { loadPortalCandidates } from "@/lib/cre-os/portal-queries";

/**
 * Pipeline. The scoreboard (the year in commission dollars, the 18-month
 * horizon, the deals that are the year, the wins) sits above the two-tab
 * kanban (Listings / Pursuits). Everything loads in parallel server-side.
 */
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [listings, pursuits, candidates, scoreboard] = await Promise.all([
    loadPipelineBoard("listings"),
    loadPipelineBoard("pursuits"),
    loadPortalCandidates(),
    loadScoreboard(),
  ]);
  return <PipelineView listings={listings} pursuits={pursuits} candidates={candidates} scoreboard={scoreboard} />;
}
