import { PipelineView } from "@/components/cre-os/pipeline/PipelineView";
import { loadPipelineBoard } from "@/lib/cre-os/pipeline-queries";

/**
 * Phase 3 — Pipeline. Two-tab kanban (Listings / Pursuits) with stage-aware
 * forecast and stage-health insights. Both boards load in parallel server-side
 * so the toggle is instant.
 */
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [listings, pursuits] = await Promise.all([
    loadPipelineBoard("listings"),
    loadPipelineBoard("pursuits"),
  ]);
  return <PipelineView listings={listings} pursuits={pursuits} />;
}
