"use client";

import { useState } from "react";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { TaskRow } from "@/components/cre-os/tasks/TaskRow";
import { LogActivityDialog } from "@/components/cre-os/activities/LogActivityDialog";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

type ActivityDefaultType = "call" | "meeting" | "note";

/**
 * Activity tab — the asset's memory. Reverse-chronological feed of every
 * email / call / meeting / stage change / valuation run / doc upload tied
 * to this property. Tasks roll up here too as a side rail.
 *
 * The "Logging" panel surfaces shortcut buttons that open LogActivityDialog
 * pre-set to the right activity type. "Upload a document" jumps to the
 * Documents tab via the onSwitchTab callback wired by PropertyTabs.
 */
export function ActivityTab({
  p,
  onSwitchTab,
}: {
  p: PropertyDetail;
  onSwitchTab?: (tab: "documents") => void;
}) {
  const [logOpen, setLogOpen] = useState<ActivityDefaultType | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Panel eyebrow="Activity timeline" num={1} title={`${p.activity.length} entries`} className="lg:col-span-2">
        {p.activity.length === 0 ? (
          <div className="py-8 text-center">
            <Eyebrow tone="muted">No activity logged</Eyebrow>
            <p className="mt-3 font-body text-[13px] text-cream-subtle max-w-md mx-auto">
              Emails, calls, meetings, valuation runs, and stage changes will appear here as the workflow touches this asset.
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-[7px] top-3 bottom-3 w-px bg-white/[0.06]" />
            <div className="space-y-5">
              {p.activity.map((a, i) => (
                <div key={a.id} className="relative pl-8">
                  <div className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 ${i === 0 ? "border-coral-400 bg-coral-400/30" : "border-white/15 bg-steward-base"}`} />
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">{a.when}</span>
                    <span className="font-heading text-[12px] font-semibold text-cream">{a.who}</span>
                    <span className="font-body text-[12px] text-cream-dim">{a.did}</span>
                  </div>
                  {a.subject && (
                    <div className="mt-1 font-heading text-[13px] text-cream">{a.subject}</div>
                  )}
                  {a.body && (
                    <p className="mt-1 font-body text-[12px] text-cream-dim leading-relaxed line-clamp-3">{a.body}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>

      <div className="space-y-6">
        <Panel eyebrow="Open tasks" num={2} title={`${p.tasks.length} queued`}>
          {p.tasks.length === 0 ? (
            <p className="font-body text-[12px] text-cream-subtle py-4">No tasks queued.</p>
          ) : (
            <div className="space-y-1">
              {p.tasks.map((t) => (
                <TaskRow key={t.id} id={t.id} title={t.title} due={t.due} tone={t.tone} status={t.status} />
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Logging" num={3} title="Add to timeline">
          <div className="space-y-2">
            <LoggingButton onClick={() => setLogOpen("call")}>+ Log a call</LoggingButton>
            <LoggingButton onClick={() => setLogOpen("meeting")}>+ Log a meeting</LoggingButton>
            <LoggingButton onClick={() => setLogOpen("note")}>+ Add a note</LoggingButton>
            <LoggingButton onClick={() => onSwitchTab?.("documents")}>+ Upload a document</LoggingButton>
          </div>
        </Panel>
      </div>

      <LogActivityDialog
        open={logOpen !== null}
        onClose={() => setLogOpen(null)}
        propertyId={p.id}
        contextLabel={p.name}
        defaultType={logOpen ?? "call"}
      />
    </div>
  );
}

function LoggingButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 rounded border border-white/[0.06] bg-white/[0.02] hover:bg-coral-400/[0.06] hover:border-coral-400/30 font-body text-[12px] text-cream-dim hover:text-cream transition-colors"
    >
      {children}
    </button>
  );
}
