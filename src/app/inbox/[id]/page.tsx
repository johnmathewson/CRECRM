import { redirect } from "next/navigation";

/**
 * Soft-cutover redirect: legacy /inbox/[id] → /cre-os/inbox/[id].
 * Preserves the lead-id deep-link so any saved URLs / email links still
 * land on the right lead in the CRE OS Inbox.
 */
export default function LegacyLeadDetailPage({ params }: { params: { id: string } }) {
  redirect(`/cre-os/inbox/${params.id}`);
}
