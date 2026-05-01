"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StatusFilter, PropertyOption } from "./inbox-split-view";

// ── Types ────────────────────────────────────────────────────────
export interface LeadRow {
  id: string;
  source: string | null;
  status: string | null;
  intent: string | null;
  urgency: string | null;
  sender_name: string | null;
  sender_email: string | null;
  sender_phone: string | null;
  property_label: string | null;
  qualifier_summary: string | null;
  raw_subject: string | null;
  raw_body?: string | null;
  draft_reply: string | null;
  final_sent_at: string | null;
  auto_ack_sent_at: string | null;
  property_id: string | null;
  linked_deal_id: string | null;
  created_at: string;
  property?: { id: string; name: string; headline: string | null } | null;
}

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

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "hot", label: "Hot" },
  { value: "today", label: "Today" },
  { value: "unmatched", label: "Unmatched" },
  { value: "promoted", label: "Promoted" },
  { value: "spam", label: "Spam" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

// ── Helpers ────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayKey(iso: string): "today" | "yesterday" | "thisWeek" | "older" {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 3600_000);
  const weekStart = new Date(today.getTime() - 6 * 24 * 3600_000);

  if (date >= today) return "today";
  if (date >= yesterday) return "yesterday";
  if (date >= weekStart) return "thisWeek";
  return "older";
}

const GROUP_LABELS: Record<string, string> = {
  hot: "Hot now",
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  older: "Older",
};

// ── Props ─────────────────────────────────────────────────────
interface ListProps {
  leads: LeadRow[];
  loading: boolean;
  selectedLeadId?: string;
  statusFilter: StatusFilter;
  propertyFilter: string;
  propertyOptions: PropertyOption[];
  onStatusFilterChange: (f: StatusFilter) => void;
  onPropertyFilterChange: (f: string) => void;
  seedingFixture: string | null;
  seedError: string | null;
  onSeed: (fixture: string) => void;
}

export default function InboxList({
  leads,
  loading,
  selectedLeadId,
  statusFilter,
  propertyFilter,
  propertyOptions,
  onStatusFilterChange,
  onPropertyFilterChange,
  seedingFixture,
  seedError,
  onSeed,
}: ListProps) {
  const [seederExpanded, setSeederExpanded] = useState(false);

  // Group leads
  const grouped = useMemo(() => {
    const out: Record<string, LeadRow[]> = { hot: [], today: [], yesterday: [], thisWeek: [], older: [] };
    for (const l of leads) {
      const isActive = !["spam", "archived", "promoted"].includes(l.status || "");
      if (l.urgency === "hot" && isActive) {
        out.hot.push(l);
      } else {
        out[dayKey(l.created_at)].push(l);
      }
    }
    return out;
  }, [leads]);

  const groupOrder: (keyof typeof GROUP_LABELS)[] = ["hot", "today", "yesterday", "thisWeek", "older"];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-baseline gap-3 px-5 pt-5 pb-2 flex-shrink-0">
        <h1 className="text-[20px] font-semibold m-0" style={{ color: C.cream }}>Inbox</h1>
        <span className="text-[11px]" style={{ color: C.charSubtle }}>
          {loading ? "loading…" : `${leads.length}`}
        </span>
        <Link
          href="/agent"
          className="ml-auto text-[10.5px] py-1 px-2.5 rounded font-semibold tracking-wider uppercase no-underline"
          style={{ border: "1px solid rgba(78,205,196,0.4)", color: C.teal }}
        >
          Agent →
        </Link>
      </div>

      {/* Filter dropdowns */}
      <div className="flex gap-2 px-5 pb-3 flex-shrink-0">
        <FilterSelect
          label="View"
          value={statusFilter}
          onChange={(v) => onStatusFilterChange(v as StatusFilter)}
          options={STATUS_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
        />
        <FilterSelect
          label="Property"
          value={propertyFilter}
          onChange={onPropertyFilterChange}
          options={[
            { value: "all", label: "All properties" },
            ...propertyOptions.map(p => ({ value: p.id, label: `${p.label} · ${p.count}` })),
          ]}
        />
      </div>

      {/* Scrollable lead list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-10 text-center text-[12px]" style={{ color: C.charSubtle }}>Loading…</div>
        ) : leads.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-[26px] mb-2 opacity-30">📭</div>
            <div className="text-[12px] mb-1" style={{ color: C.charMuted }}>
              No leads matching this filter
            </div>
            <div className="text-[10.5px]" style={{ color: C.charSubtle }}>
              Try widening the filter or seed a synthetic lead below.
            </div>
          </div>
        ) : (
          <>
            {groupOrder.map(group => {
              const items = grouped[group];
              if (!items || items.length === 0) return null;
              return (
                <div key={group}>
                  <DateHeader label={GROUP_LABELS[group]} count={items.length} />
                  {items.map(lead => (
                    <LeadRowItem
                      key={lead.id}
                      lead={lead}
                      selected={lead.id === selectedLeadId}
                    />
                  ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Compact seeder footer */}
      <div
        className="flex-shrink-0 px-3 py-2 border-t"
        style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.18)" }}
      >
        {!seederExpanded ? (
          <button
            onClick={() => setSeederExpanded(true)}
            className="text-[10.5px] w-full py-1.5"
            style={{ color: C.charSubtle, textAlign: "left" }}
          >
            ⚙ Test seeds (Slice C will replace this with Gmail) →
          </button>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.charSubtle }}>
                Test seeds
              </span>
              <button
                onClick={() => setSeederExpanded(false)}
                className="text-[10.5px]"
                style={{ color: C.charSubtle }}
              >✕</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { id: "crexi_buyer", label: "CREXi" },
                { id: "loopnet_tenant", label: "LoopNet" },
                { id: "cold_unmatched", label: "Cold" },
                { id: "vendor_spam", label: "Spam" },
                { id: "sms_inquiry", label: "SMS" },
                { id: "voicemail_callback", label: "Voice" },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => onSeed(f.id)}
                  disabled={seedingFixture !== null}
                  className="text-[10.5px] py-1 px-2 rounded"
                  style={{
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.02)",
                    color: C.charMuted,
                    cursor: seedingFixture !== null ? "wait" : "pointer",
                    opacity: seedingFixture && seedingFixture !== f.id ? 0.4 : 1,
                  }}
                >
                  {seedingFixture === f.id ? "…" : f.label}
                </button>
              ))}
            </div>
            {seedError && (
              <div className="text-[10px] mt-1" style={{ color: C.red }}>{seedError}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex-1 min-w-0">
      <span
        className="block text-[9px] tracking-wider uppercase font-semibold mb-1"
        style={{ color: C.charSubtle }}
      >
        {label}
      </span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none cursor-pointer text-[11.5px] py-1.5 pl-2.5 pr-7 rounded font-medium"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: C.cream,
            outline: "none",
          }}
        >
          {options.map(o => (
            <option
              key={o.value}
              value={o.value}
              style={{ background: "#1a1a1a", color: C.cream }}
            >
              {o.label}
            </option>
          ))}
        </select>
        <span
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-[9px]"
          style={{ color: C.charSubtle }}
        >
          ▾
        </span>
      </div>
    </label>
  );
}

function DateHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      className="text-[9.5px] tracking-[0.18em] uppercase font-semibold px-5 pt-4 pb-1.5 flex items-baseline gap-2"
      style={{ color: "rgba(240,237,228,0.4)" }}
    >
      <span>{label}</span>
      <span style={{ color: "rgba(240,237,228,0.25)" }}>{count}</span>
    </div>
  );
}

function LeadRowItem({ lead, selected }: { lead: LeadRow; selected: boolean }) {
  const urgency = lead.urgency || "warm";
  const stripeColor = URGENCY_COLOR[urgency] || URGENCY_COLOR.warm;
  const matched = !!lead.property;
  const isSpam = lead.status === "spam";
  const isArchived = lead.status === "archived";
  const muted = isSpam || isArchived;

  const matchTag = matched
    ? { label: lead.property?.headline || lead.property?.name || "matched", color: C.green, bg: "rgba(107,203,119,0.15)" }
    : lead.property_label
    ? { label: `${lead.property_label} · review`, color: C.amber, bg: "rgba(242,201,76,0.12)" }
    : null;

  const intent = lead.intent
    ? { label: lead.intent.toUpperCase(), color: C.cream, bg: "rgba(255,255,255,0.05)" }
    : null;

  return (
    <Link
      href={`/inbox/${lead.id}`}
      className="block group"
      style={{
        textDecoration: "none",
        background: selected ? "rgba(224,122,95,0.07)" : "transparent",
        borderLeft: `3px solid ${selected ? C.coral : stripeColor}`,
        transition: "background 0.12s",
        opacity: muted ? 0.55 : 1,
      }}
    >
      <div className="px-4 py-2.5 hover:bg-white/[0.02]">
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className="text-[12.5px] font-semibold flex-1 truncate"
            style={{ color: C.cream }}
          >
            {lead.sender_name || lead.sender_email || lead.sender_phone || "Anonymous"}
          </span>
          {lead.final_sent_at ? (
            <span className="text-[9px] font-bold tracking-wider uppercase flex-shrink-0" style={{ color: C.green }}>
              ✓ Sent
            </span>
          ) : lead.auto_ack_sent_at ? (
            <span className="text-[9px] font-bold tracking-wider uppercase flex-shrink-0" style={{ color: C.amber }}>
              ◷ Acked
            </span>
          ) : null}
          <span className="text-[10px] flex-shrink-0" style={{ color: C.charSubtle }}>
            {timeAgo(lead.created_at)}
          </span>
        </div>

        {(intent || matchTag) && (
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            {intent && (
              <span
                className="text-[9px] font-bold py-[1px] px-1.5 rounded tracking-wider"
                style={{ background: intent.bg, color: intent.color }}
              >
                {intent.label}
              </span>
            )}
            {matchTag && (
              <span
                className="text-[9.5px] font-semibold py-[1px] px-1.5 rounded truncate max-w-[230px]"
                style={{ background: matchTag.bg, color: matchTag.color }}
              >
                {matchTag.label}
              </span>
            )}
          </div>
        )}

        {lead.qualifier_summary && (
          <div
            className="text-[11.5px] leading-tight line-clamp-2"
            style={{ color: C.charMuted }}
          >
            {lead.qualifier_summary}
          </div>
        )}
      </div>
    </Link>
  );
}
