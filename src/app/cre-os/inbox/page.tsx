import { InboxView } from "@/components/cre-os/inbox/InboxView";
import { loadInboxList } from "@/lib/cre-os/inbox-queries";

/**
 * Phase 5 — Inbox / Lead Command. Server-renders the list with real urgency
 * + draft + SLA state. Client handles bucket toggling and search.
 */
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const leads = await loadInboxList();
  return <InboxView leads={leads} />;
}
