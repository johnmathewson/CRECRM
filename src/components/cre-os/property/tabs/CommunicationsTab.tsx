"use client";

import { CommunicationsPanel } from "@/components/cre-os/CommunicationsPanel";
import type { ThreadSummary } from "@/lib/cre-os/communications-queries";

/**
 * Communications tab on the Property workspace. Slots between Valuation &
 * Comps and Performance per the agreed tab order. Read-only in v1; reply /
 * compose lands with Phase 5's send-flow.
 */
export function CommunicationsTab({
  threads,
  propertyName,
}: {
  threads: ThreadSummary[];
  propertyName: string;
}) {
  return (
    <CommunicationsPanel
      threads={threads}
      num={1}
      emptyMessage={`No conversations linked to ${propertyName} yet. Email and SMS conversations referencing this property will thread here once the inbox watcher (Phase 5) is live, or when you tag an outbound email FROM this workspace.`}
    />
  );
}
