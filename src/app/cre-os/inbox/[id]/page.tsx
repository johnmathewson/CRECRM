import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/cre-os/inbox/LeadDetail";
import { loadLeadDetail } from "@/lib/cre-os/inbox-queries";

/**
 * Phase 5 — Lead detail / draft review. The page Twilio SMS deeplinks land
 * on. Sticky bottom action bar holds Send / Archive / Spam / Promote.
 */
export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const lead = await loadLeadDetail(params.id);
  if (!lead) notFound();
  return <LeadDetail lead={lead} />;
}
