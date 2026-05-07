import { notFound } from "next/navigation";
import { DealWorkspace } from "@/components/cre-os/pipeline/DealWorkspace";
import { loadDealDetail } from "@/lib/cre-os/pipeline-queries";

/**
 * Phase 3 — Deal workspace. Stage stepper + stage-aware guidance (required
 * fields, doc checklist, recommended actions, common risks) + history +
 * tasks/activity. The system tightening around the workflow per the vision.
 */
export const dynamic = "force-dynamic";

export default async function DealPage({ params }: { params: { id: string } }) {
  const detail = await loadDealDetail(params.id);
  if (!detail) notFound();
  return <DealWorkspace d={detail} />;
}
