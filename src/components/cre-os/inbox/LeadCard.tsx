"use client";

import { useRouter } from "next/navigation";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { useContactDrawer } from "@/components/cre-os/ContactDrawer";
import type { LeadCard as LeadCardData } from "@/lib/cre-os/inbox-queries";

/**
 * LeadCard — single lead in the inbox list. Mobile-first: full-width,
 * thumb-zone friendly, scannable in two seconds.
 *
 * Visual urgency:
 *   • coral left-bar + coral border on SLA-overdue or hot+new
 *   • amber left-bar on warm needing response
 *   • dim border on archived / sent / cold
 */
export function LeadCard({ lead }: { lead: LeadCardData }) {
  const { openLead } = useContactDrawer();
  const router = useRouter();
  const status = (lead.status ?? "").toLowerCase();
  const isArchived = status === "archived" || status === "spam";
  const isHotPending = lead.urgency === "hot" && !lead.finalSent && !isArchived;
  const isUrgent = lead.slaOverdue || isHotPending;
  const isWarm = lead.urgency === "warm" && status === "new" && !lead.finalSent;

  const cardClass = isArchived
    ? "border border-white/[0.04] bg-steward-mid/30 opacity-70"
    : isUrgent
      ? "border-l-2 border-l-coral-400 border-y border-r border-y-coral-400/20 border-r-coral-400/20 bg-coral-400/[0.03]"
      : isWarm
        ? "border-l-2 border-l-amber/60 border-y border-r border-y-white/[0.05] border-r-white/[0.05]"
        : "border border-white/[0.05] bg-steward-mid/40";

  return (
    <button
      type="button"
      onClick={() => openLead(lead.id, { onChange: () => router.refresh() })}
      className={`block w-full text-left group rounded-md p-4 transition-all hover:border-coral-400/30 cursor-pointer ${cardClass}`}
    >
      {/* Top row: sender + urgency */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display font-medium text-base text-cream group-hover:text-coral-300 transition-colors truncate">
              {lead.senderDisplay}
            </span>
            {lead.urgency && (
              <StatusBadge size="xs" tone={toneForUrgency(lead.urgency)}>
                {lead.urgency}
              </StatusBadge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-cream-subtle">
            {lead.source && <span className="uppercase tracking-eyebrow">{lead.source}</span>}
            {lead.intent && <span>·  intent: {lead.intent}</span>}
            <span>·  {lead.createdRelative}</span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {lead.slaOverdue && <StatusBadge size="xs" tone="coral">SLA overdue</StatusBadge>}
          {!lead.slaOverdue && status === "new" && <StatusBadge size="xs" tone="coral">New</StatusBadge>}
          {status === "archived" && <StatusBadge size="xs" tone="neutral">Archived</StatusBadge>}
          {status === "spam" && <StatusBadge size="xs" tone="neutral">Spam</StatusBadge>}
          {lead.finalSent && <StatusBadge size="xs" tone="teal">Sent</StatusBadge>}
          {lead.promotedToDeal && <StatusBadge size="xs" tone="teal">Deal</StatusBadge>}
        </div>
      </div>

      {/* Property reference */}
      {(lead.property || lead.propertyLabel) && (
        <div className="mt-2">
          <Eyebrow tone="coral">RE: {lead.property?.name || lead.propertyLabel}</Eyebrow>
        </div>
      )}

      {/* AI qualifier summary OR raw subject + preview */}
      <div className="mt-2 space-y-1">
        {lead.qualifierSummary && (
          <p className="font-body text-[13px] text-cream leading-snug line-clamp-2">
            {lead.qualifierSummary}
          </p>
        )}
        {lead.rawSubject && !lead.qualifierSummary && (
          <p className="font-body text-[13px] text-cream font-medium leading-snug truncate">
            {lead.rawSubject}
          </p>
        )}
        {lead.bodyPreview && (
          <p className="font-body text-[11px] text-cream-dim leading-snug line-clamp-2">
            {lead.bodyPreview}
          </p>
        )}
      </div>

      {/* Footer: state chips */}
      <div className="mt-3 pt-2 border-t border-white/[0.04] flex items-center gap-2 flex-wrap font-mono text-[10px] text-cream-subtle">
        {lead.ackSent ? (
          <span className="text-teal-300">✓ Auto-ack sent</span>
        ) : (
          <span>Auto-ack pending</span>
        )}
        {lead.hasDraft && !lead.finalSent && <span className="text-coral-300">· Draft ready</span>}
        {lead.finalSent && <span className="text-teal-300">· Reply sent</span>}
      </div>
    </button>
  );
}

function toneForUrgency(u: string | null): "coral" | "amber" | "teal" | "neutral" {
  if (u === "hot") return "coral";
  if (u === "warm") return "amber";
  if (u === "cold") return "neutral";
  return "neutral";
}
