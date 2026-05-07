"use client";

import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { ThreadSummary } from "@/lib/cre-os/communications-queries";

/**
 * CommunicationsPanel — threaded conversation list. Used on both Property
 * and Contact workspaces with the same shape; the source query differs
 * (loadCommunicationsForProperty vs loadCommunicationsForContact).
 *
 * Threading: each row represents one conversation (Gmail thread or normalized
 * subject), not one message. Shows participants, last activity, message
 * count, in/out direction split, unread state.
 *
 * v1 is read-only. Phase 5 wires reply/compose actions from here.
 */
export function CommunicationsPanel({
  threads,
  num,
  emptyMessage,
}: {
  threads: ThreadSummary[];
  num?: number;
  emptyMessage?: string;
}) {
  return (
    <Panel
      eyebrow="Communications"
      num={num}
      title={threads.length === 0 ? "No conversations yet" : `${threads.length} conversation${threads.length === 1 ? "" : "s"}`}
      actions={
        <span className="font-mono text-[10px] text-cream-subtle">
          Read-only · reply &amp; compose in Phase 5
        </span>
      }
    >
      {threads.length === 0 ? (
        <p className="font-body text-[13px] text-cream-subtle py-6 text-center">
          {emptyMessage ?? "Email and SMS conversations tied to this record will appear here once the inbox watcher (Phase 5) lands."}
        </p>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => <ThreadRow key={t.threadKey} t={t} />)}
        </div>
      )}
    </Panel>
  );
}

function ThreadRow({ t }: { t: ThreadSummary }) {
  const participants = t.participants
    .slice(0, 3)
    .map((p) => p.name || p.email || "Unknown")
    .join(", ");
  const more = t.participants.length > 3 ? ` +${t.participants.length - 3}` : "";

  return (
    <div className={`group rounded border ${t.hasUnread ? "border-coral-400/30 bg-coral-400/[0.03]" : "border-white/[0.05] bg-white/[0.02]"} p-3 hover:bg-white/[0.04] transition-colors`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {t.hasUnread && <span className="w-1.5 h-1.5 rounded-full bg-coral-400 shrink-0" />}
            <span className="font-heading text-[12px] font-semibold text-cream truncate">{t.subject}</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">
            {participants}{more}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {t.channel && (
            <StatusBadge size="xs" tone="neutral">
              {t.channel.toLowerCase() === "email" ? "✉" : t.channel.toLowerCase() === "sms" ? "sms" : t.channel}
            </StatusBadge>
          )}
          <span className="font-mono text-[10px] text-cream-subtle">{t.lastWhen}</span>
        </div>
      </div>

      {t.lastBodyPreview && (
        <p className="mt-1.5 font-body text-[11px] text-cream-dim line-clamp-2 leading-snug">
          {t.lastBodyPreview}
        </p>
      )}

      <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-cream-subtle">
        <span>{t.messageCount} message{t.messageCount === 1 ? "" : "s"}</span>
        {t.inboundCount > 0 && <span>· {t.inboundCount} inbound</span>}
        {t.outboundCount > 0 && <span>· {t.outboundCount} outbound</span>}
      </div>
    </div>
  );
}
