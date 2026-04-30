"use client";

import InboxList from "./inbox-list";
import LeadDetailContent from "./lead-detail-content";

interface Props {
  selectedLeadId?: string;
}

const C = {
  cream: "#F0EDE4",
  charSubtle: "rgba(240,237,228,0.55)",
  charMuted: "rgba(240,237,228,0.75)",
};

export default function InboxSplitView({ selectedLeadId }: Props) {
  return (
    <div
      className="flex w-full"
      style={{ height: "calc(100vh - 56px)" }}
    >
      {/* List pane — full width on mobile when no detail; 380px on desktop always */}
      <aside
        className={`
          ${selectedLeadId ? "hidden lg:flex" : "flex"}
          flex-col w-full lg:w-[380px] lg:max-w-[380px] flex-shrink-0
          lg:border-r overflow-hidden
        `}
        style={{ borderColor: "rgba(255,255,255,0.05)" }}
      >
        <InboxList selectedLeadId={selectedLeadId} />
      </aside>

      {/* Detail pane — visible on mobile when selected; always visible on desktop */}
      <section
        className={`
          ${selectedLeadId ? "flex" : "hidden lg:flex"}
          flex-col flex-1 overflow-hidden
        `}
      >
        {selectedLeadId ? (
          <LeadDetailContent leadId={selectedLeadId} mode="pane" />
        ) : (
          <EmptyDetail />
        )}
      </section>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-10">
      <div className="text-[48px] opacity-20 mb-4">✉️</div>
      <div className="text-[14px] mb-2" style={{ color: C.charMuted }}>
        Select a lead to review
      </div>
      <div className="text-[11px] max-w-[320px]" style={{ color: C.charSubtle }}>
        New inbound emails, SMS, and voicemails will appear in the queue. The agent qualifies
        them, matches to a property if it can, and drafts a reply for you to review.
      </div>
    </div>
  );
}
