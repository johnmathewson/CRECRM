import { PipelineView } from "@/components/cre-os/pipeline/PipelineView";
import { loadPipelineBoard } from "@/lib/cre-os/pipeline-queries";
import { loadPortalCandidates } from "@/lib/cre-os/portal-queries";

/**
 * Phase 3 — Pipeline. Two-tab kanban (Listings / Pursuits) with stage-aware
 * forecast and stage-health insights. Both boards load in parallel server-side
 * so the toggle is instant. Phase 8 — also loads property/contact candidates
 * for the "+ Add deal" dialog.
 */
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [listings, pursuits, candidates] = await Promise.all([
    loadPipelineBoard("listings"),
    loadPipelineBoard("pursuits"),
    loadPortalCandidates(),
  ]);
  return <PipelineView listings={listings} pursuits={pursuits} candidates={candidates} />;
}
