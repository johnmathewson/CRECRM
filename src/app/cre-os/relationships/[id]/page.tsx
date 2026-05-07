import { notFound } from "next/navigation";
import { ContactWorkspace } from "@/components/cre-os/relationship/ContactWorkspace";
import { loadContactDetail } from "@/lib/cre-os/relationship-queries";
import { loadCommunicationsForContact } from "@/lib/cre-os/communications-queries";
import { summarizeContact } from "@/lib/cre-os/ai-summaries";

/**
 * Phase 4 — Contact workspace. Pulls contact detail, threaded
 * communications, and a Haiku-backed AI synthesis line in parallel.
 */
export const dynamic = "force-dynamic";

export default async function ContactDetailPage({ params }: { params: { id: string } }) {
  const detail = await loadContactDetail(params.id);
  if (!detail) notFound();

  const [threads, aiSynthesis] = await Promise.all([
    loadCommunicationsForContact(detail.id),
    summarizeContact(detail),
  ]);

  return <ContactWorkspace contact={detail} aiSynthesis={aiSynthesis} threads={threads} />;
}
