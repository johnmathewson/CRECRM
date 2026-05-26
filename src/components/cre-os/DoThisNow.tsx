"use client";

import { useRouter } from "next/navigation";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { useContactDrawer } from "@/components/cre-os/ContactDrawer";
import type { LeadCard as LeadCardData } from "@/lib/cre-os/inbox-queries";

/**
 * DoThisNow — the Command Center's ranked action queue.
 *
 * One prioritized list of leads that need a human touch right now, sorted
 * by urgency. Each row opens the universal ContactDrawer in-context — no
 * navigation — so you triage the whole queue without ever leaving the page.
 *
 * Ranking (high → low):
 *   1. SLA-overdue (any urgency)
 *   2. Hot + no reply yet
 *   3. Draft ready to send (easy win)
 *   4. Warm + new
 */

function priority(l: LeadCardData): number {
  const status = (l.status ?? "").toLowerCase();
  // Exclude definitively handled leads. "sent" is explicit because finalSent
  // relies on final_sent_at being set — if that column is null for any reason,
  // the lead would otherwise score 500+ and appear at the top of the queue.
  if (status === "archived" || status === "spam" || status === "sent" || l.finalSent) return -1;
  let p = 0;
  if (l.urgency === "hot") p += 500;
  else if (l.urgency === "warm") p += 250;
  if (l.slaOverdue) p += 400;
  if (l.hasDraft) p += 300; // easy win — draft already written
  if (status === "new") p += 100;
  return p;
}

function actionHint(l: LeadCardData): string {
  if (l.hasDraft && !l.finalSent) return "Send draft";
  return "Reply";
}

function urgencyTone(u: string | null): "coral" | "amber" | "teal" | "neutral" {
  if (u === "hot") return "coral";
  if (u === "warm") return "amber";
  if (u === "cold") return "teal";
  return "neutral";
}

export function DoThisNow({ leads }: { leads: LeadCardData[] }) {
  const { openLead } = useContactDrawer();
  const router = useRouter();

  const ranked = leads
    .map((l) => ({ l, p: priority(l) }))
    .filter((x) => x.p >= 0)
    .sort((a, b) => b.p - a.p)
    .slice(0, 8)
    .map((x) => x.l);

  if (ranked.length === 0) {
    return (
      <Panel eyebrow="Do this now" num={0} title="Action queue">
        <div className="py-6 text-center font-body text-[13px] text-cream-subtle">
          Inbox zero — nothing needs a response right now. 🎯
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      eyebrow="Do this now"
      num={0}
      title="Action queue"
      actions={
        <a href="/cre-os/inbox" className="font-heading text-[11px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">
          Full inbox →
        </a>
      }
    >
      <div className="space-y-2">
        {ranked.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => openLead(l.id, { onChange: () => router.refresh() })}
            className="block w-full text-left rounded-md border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] hover:border-coral-400/30 transition-colors p-3 group"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display font-medium text-[14px] text-cream group-hover:text-coral-300 transition-colors truncate">
                    {l.senderDisplay}
                  </span>
                  {l.urgency && <StatusBadge size="xs" tone={urgencyTone(l.urgency)}>{l.urgency}</StatusBadge>}
                  {l.slaOverdue && <StatusBadge size="xs" tone="coral">SLA overdue</StatusBadge>}
                  {l.hasDraft && !l.finalSent && <StatusBadge size="xs" tone="amber">Draft ready</StatusBadge>}
                </div>
                <p className="mt-1 font-body text-[12px] text-cream-dim leading-snug line-clamp-1">
                  {l.qualifierSummary || l.rawSubject || "New inquiry"}
                  {(l.property?.name || l.propertyLabel) && (
                    <span className="text-cream-subtle"> · {l.property?.name || l.propertyLabel}</span>
                  )}
                </p>
              </div>
              <span className="shrink-0 font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 group-hover:text-coral-300 self-center">
                {actionHint(l)} →
              </span>
            </div>
          </button>
        ))}
      </div>
    </Panel>
  );
}
