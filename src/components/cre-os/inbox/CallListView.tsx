"use client";

import { useMemo } from "react";
import type { LeadCard as LeadCardData } from "@/lib/cre-os/inbox-queries";

/**
 * CallListView — leads ranked by priority score for outbound calling.
 *
 * Compact list optimized for the call motion:
 *   - Sorted by priorityScore descending (highest = call first)
 *   - Filters out unreachable (no phone AND no email) and terminal
 *     outcomes (dead / wrong_number logged)
 *   - Big phone number, tap-to-dial via tel: link
 *   - Property + intent chip so the broker knows the context before
 *     dialing
 *   - Last-touch line: never contacted / emailed 3d ago / called yesterday
 *   - Click anywhere else on the card → opens ContactCallPanel via
 *     onOpen callback, so the broker can review email history + notes
 *     + log the call
 */
export function CallListView({
  leads,
  onOpen,
}: {
  leads: LeadCardData[];
  onOpen: (leadId: string) => void;
}) {
  const ranked = useMemo(() => {
    return leads
      .filter((l) => {
        // Skip dead / wrong_number leads — they'll bubble to the bottom
        // via score anyway, but omit for a clean UI
        if (l.lastCallOutcome === "dead" || l.lastCallOutcome === "wrong_number") return false;
        // No contact channels at all → not callable
        if (!l.senderPhone && !l.senderEmail) return false;
        // Archived / spam bucket → out
        const status = (l.status ?? "").toLowerCase();
        if (status === "archived" || status === "spam") return false;
        return true;
      })
      .sort((a, b) => b.priorityScore - a.priorityScore);
  }, [leads]);

  if (ranked.length === 0) {
    return (
      <div className="rounded border border-white/[0.06] bg-white/[0.02] py-12 text-center">
        <p className="font-body text-[13px] text-cream-subtle">
          No callable leads. Everything's been touched or has no contact info.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ranked.map((l) => (
        <CallRow key={l.id} lead={l} onOpen={onOpen} />
      ))}
    </div>
  );
}

function CallRow({
  lead,
  onOpen,
}: {
  lead: LeadCardData;
  onOpen: (leadId: string) => void;
}) {
  const hasPhone = !!lead.senderPhone;
  const lastTouch = lastTouchLine(lead);
  const priorityTone =
    lead.priorityScore >= 100 ? "coral" : lead.priorityScore >= 60 ? "amber" : "neutral";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(lead.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(lead.id);
        }
      }}
      className={`group rounded border bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors p-4 flex items-start gap-4 ${
        priorityTone === "coral"
          ? "border-l-2 border-l-coral-400 border-y-white/[0.06] border-r-white/[0.06]"
          : priorityTone === "amber"
            ? "border-l-2 border-l-amber-400/60 border-y-white/[0.05] border-r-white/[0.05]"
            : "border-white/[0.05]"
      }`}
    >
      {/* Left: identity + context */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-heading text-[14px] font-semibold text-cream group-hover:text-coral-300 transition-colors truncate">
            {lead.senderDisplay}
          </span>
          {lead.urgency && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[9.5px] uppercase tracking-eyebrow ${
                lead.urgency === "hot"
                  ? "border-coral-400/40 bg-coral-400/[0.10] text-coral-300"
                  : lead.urgency === "warm"
                    ? "border-amber-400/40 bg-amber-400/[0.10] text-amber-300"
                    : "border-white/[0.08] bg-white/[0.02] text-cream-subtle"
              }`}
            >
              {lead.urgency}
            </span>
          )}
          {lead.intent && (
            <span className="font-mono text-[10px] text-cream-subtle">
              · intent: {lead.intent}
            </span>
          )}
          {lead.property && (
            <span className="font-mono text-[10px] text-cream-subtle truncate">
              · {lead.property.name}
            </span>
          )}
        </div>
        {lead.qualifierSummary && (
          <p className="mt-1 font-body text-[12px] text-cream-dim line-clamp-2">
            {lead.qualifierSummary}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3 flex-wrap font-mono text-[10.5px] text-cream-subtle">
          <span>{lastTouch}</span>
          <span className="opacity-40">·</span>
          <span>arrived {lead.createdRelative}</span>
          {lead.callCount > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span>
                {lead.callCount} call{lead.callCount === 1 ? "" : "s"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right: phone action (big + prominent) */}
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        {hasPhone ? (
          <a
            href={`tel:${lead.senderPhone}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-teal-400/50 bg-teal-400/[0.12] hover:bg-teal-400/[0.22] font-heading text-[11.5px] font-semibold text-teal-300 transition-colors whitespace-nowrap"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path
                d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.86 19.86 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {lead.senderPhone}
          </a>
        ) : (
          <span className="font-mono text-[10px] text-cream-subtle">no phone · email only</span>
        )}
        <span className="font-mono text-[9.5px] text-cream-subtle">
          score {lead.priorityScore}
        </span>
      </div>
    </div>
  );
}

function lastTouchLine(l: LeadCardData): string {
  if (l.lastCallAt) {
    const days = Math.floor((Date.now() - new Date(l.lastCallAt).getTime()) / 86_400_000);
    const outcome = l.lastCallOutcome ? ` · ${l.lastCallOutcome.replace(/_/g, " ")}` : "";
    return days === 0 ? `Called today${outcome}` : `Called ${days}d ago${outcome}`;
  }
  if (l.finalSent) return "Emailed reply sent";
  return "Never contacted";
}
