"use client";

import Link from "next/link";
import type { LeadRow } from "./inbox-list";
import type { StatusFilter, PropertyOption } from "./inbox-split-view";

const C = {
  coral: "#E07A5F",
  teal: "#4ECDC4",
  amber: "#F2C94C",
  red: "#E74C3C",
  green: "#6BCB77",
  cream: "#F0EDE4",
  charSubtle: "rgba(240,237,228,0.55)",
  charMuted: "rgba(240,237,228,0.75)",
};

const URGENCY_COLOR: Record<string, string> = {
  hot: C.red,
  warm: C.amber,
  cold: C.teal,
};

const SOURCE_LABEL: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  voice: "Voice",
  phone: "Phone",
  website: "Website",
  manual_test: "Test",
  crexi: "CREXi",
  loopnet: "LoopNet",
};

interface Props {
  leads: LeadRow[];
  loading: boolean;
  statusFilter: StatusFilter;
  propertyFilter: string;
  propertyOptions: PropertyOption[];
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function viewLabel(filter: StatusFilter): string {
  switch (filter) {
    case "active": return "Active leads";
    case "hot": return "Hot leads";
    case "today": return "Today's leads";
    case "unmatched": return "Unmatched leads";
    case "promoted": return "Promoted leads";
    case "spam": return "Spam";
    case "archived": return "Archived";
    case "all": return "All leads";
    default: return "Leads";
  }
}

export default function InboxOverview({
  leads,
  loading,
  statusFilter,
  propertyFilter,
  propertyOptions,
}: Props) {
  const propertyLabel =
    propertyFilter === "all"
      ? null
      : propertyFilter === "unmatched"
      ? "Unmatched only"
      : propertyOptions.find(p => p.id === propertyFilter)?.label || null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex-shrink-0 px-7 pt-6 pb-3"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-[18px] font-semibold m-0" style={{ color: C.cream }}>
            {viewLabel(statusFilter)}
          </h2>
          <span className="text-[12px]" style={{ color: C.charSubtle }}>
            {loading ? "loading…" : `${leads.length} ${leads.length === 1 ? "lead" : "leads"}`}
          </span>
          {propertyLabel && (
            <span
              className="text-[10.5px] font-semibold py-[2px] px-2 rounded uppercase tracking-wider"
              style={{ background: "rgba(78,205,196,0.12)", color: C.teal }}
            >
              {propertyLabel}
            </span>
          )}
        </div>
        <div className="text-[11px] mt-1" style={{ color: C.charSubtle }}>
          Click a lead to open the detail view.
        </div>
      </div>

      {/* Card stack — scrolls within pane */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 space-y-3 max-w-[860px] mx-auto">
          {loading ? (
            <div className="text-center py-12 text-[13px]" style={{ color: C.charSubtle }}>
              Loading…
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-[40px] mb-3 opacity-25">📭</div>
              <div className="text-[14px] mb-1" style={{ color: C.charMuted }}>
                Nothing matches this filter
              </div>
              <div className="text-[11.5px]" style={{ color: C.charSubtle }}>
                Adjust the dropdowns above, or seed a synthetic lead from the list panel.
              </div>
            </div>
          ) : (
            leads.map(lead => <OverviewCard key={lead.id} lead={lead} />)
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ lead }: { lead: LeadRow }) {
  const urgency = lead.urgency || "warm";
  const stripeColor = URGENCY_COLOR[urgency] || URGENCY_COLOR.warm;
  const matched = !!lead.property;
  const muted = lead.status === "spam" || lead.status === "archived";

  return (
    <Link
      href={`/inbox/${lead.id}`}
      className="block glass relative no-underline"
      style={{
        padding: 16,
        opacity: muted ? 0.55 : 1,
        transition: "transform 0.12s, background 0.12s",
        textDecoration: "none",
      }}
    >
      {/* Urgency stripe */}
      <div
        className="absolute left-0 top-0 bottom-0"
        style={{
          width: 3,
          background: stripeColor,
          borderTopLeftRadius: 5,
          borderBottomLeftRadius: 5,
        }}
      />

      <div className="ml-2">
        {/* Top row: sender + status pills + time */}
        <div className="flex items-baseline gap-2 mb-2 flex-wrap">
          <span className="text-[14px] font-semibold" style={{ color: C.cream }}>
            {lead.sender_name || lead.sender_email || lead.sender_phone || "Anonymous"}
          </span>
          <span className="text-[10.5px]" style={{ color: C.charSubtle }}>
            {SOURCE_LABEL[lead.source || "email"] || lead.source || "email"}
          </span>
          {lead.urgency && (
            <span
              className="text-[9px] font-bold py-[2px] px-1.5 rounded tracking-wider uppercase"
              style={{
                background: urgency === "hot" ? "rgba(231,76,60,0.18)" : urgency === "cold" ? "rgba(78,205,196,0.18)" : "rgba(242,201,76,0.18)",
                color: stripeColor,
              }}
            >
              {urgency}
            </span>
          )}
          {lead.intent && (
            <span
              className="text-[9px] font-bold py-[2px] px-1.5 rounded tracking-wider uppercase"
              style={{ background: "rgba(255,255,255,0.05)", color: C.cream }}
            >
              {lead.intent}
            </span>
          )}
          {lead.status && lead.status !== "new" && (
            <span
              className="text-[9px] font-bold py-[2px] px-1.5 rounded tracking-wider uppercase"
              style={{ background: "rgba(224,122,95,0.12)", color: C.coral }}
            >
              {lead.status}
            </span>
          )}
          <span className="ml-auto text-[10.5px]" style={{ color: C.charSubtle }}>
            {fmtTime(lead.created_at)}
          </span>
        </div>

        {/* Property match */}
        <div className="mb-2">
          {matched ? (
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 12, color: C.green }}>✓</span>
              <span className="text-[11.5px] font-semibold" style={{ color: C.green }}>
                {lead.property?.headline || lead.property?.name}
              </span>
            </div>
          ) : lead.property_label ? (
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 12, color: C.amber }}>⚠</span>
              <span className="text-[11.5px]" style={{ color: C.amber }}>
                "{lead.property_label}" — needs review
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
               <span style={{ fontSize: 12, color: C.charSubtle }}>·</span>
               <span className="text-[11.5px]" style={{ color: C.charSubtle }}>
                 No property reference
               </span>
            </div>
          )}
        </div>

        {/* Subject + summary */}
        {lead.raw_subject && (
          <div className="text-[11.5px] mb-1.5" style={{ color: C.charMuted }}>
            <span style={{ color: C.charSubtle }}>Subject:</span> {lead.raw_subject}
          </div>
        )}

        {lead.qualifier_summary && (
          <div
            className="text-[12.5px] leading-relaxed mb-2"
            style={{ color: C.charMuted }}
          >
            {lead.qualifier_summary}
          </div>
        )}

        {/* Footer: draft state */}
        <div
          className="flex items-center gap-3 pt-2 mt-2 text-[10.5px]"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)", color: C.charSubtle }}
        >
          {lead.draft_reply ? (
            <span style={{ color: C.teal }}>✍️ Draft ready · {lead.draft_reply.length} chars</span>
          ) : (
            <span>No draft</span>
          )}
          <span className="ml-auto" style={{ color: C.coral }}>Open →</span>
        </div>
      </div>
    </Link>
  );
}
