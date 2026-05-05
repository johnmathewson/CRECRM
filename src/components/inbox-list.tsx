"use client";

import { useMemo, useState, useCallback } from "react";
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

// Sources that represent a real human reaching out (vs. CREXi engagement
// signals where we're observing them, not the other way around).
const REAL_INBOUND_SOURCES = new Set([
  "email", "sms", "voice", "website", "phone", "referral", "walk_in",
]);

// Pill filters — each one shows a slice of the inbox + drives the section
// rendering. "All" keeps every section visible.
type Pill = "all" | "needs_review" | "new" | "engagement" | "sent" | "archived" | "spam";

const PILLS: { id: Pill; label: string; tint: string }[] = [
  { id: "all",          label: "All",          tint: C.cream },
  { id: "needs_review", label: "Needs review", tint: C.green },
  { id: "new",          label: "New",          tint: C.coral },
  { id: "engagement",   label: "Engagement",   tint: C.teal },
  { id: "sent",         label: "Sent",         tint: C.charMuted },
  { id: "archived",     label: "Archived",     tint: C.charSubtle },
  { id: "spam",         label: "Spam",         tint: "#888" },
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

function classifyLead(lead: LeadRow): Pill | "other" {
  const status = (lead.status || "").toLowerCase();
  if (status === "spam") return "spam";
  if (status === "archived") return "archived";
  if (lead.final_sent_at) return "sent";
  if (lead.draft_reply) return "needs_review";
  if (REAL_INBOUND_SOURCES.has((lead.source || "").toLowerCase())) return "new";
  if ((lead.source || "").toLowerCase() === "crexi") return "engagement";
  return "other";
}

function leadHas(lead: LeadRow, search: string): boolean {
  if (!search) return true;
  const s = search.toLowerCase();
  return (
    (lead.sender_name || "").toLowerCase().includes(s) ||
    (lead.sender_email || "").toLowerCase().includes(s) ||
    (lead.sender_phone || "").toLowerCase().includes(s) ||
    (lead.qualifier_summary || "").toLowerCase().includes(s) ||
    (lead.property?.name || "").toLowerCase().includes(s) ||
    (lead.property?.headline || "").toLowerCase().includes(s)
  );
}

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
  onLeadsChanged: () => void;
  seedingFixture: string | null;
  seedError: string | null;
  onSeed: (fixture: string) => void;
}

// Map our pill model to the upstream StatusFilter that drives the server query
function pillToStatusFilter(p: Pill): StatusFilter {
  switch (p) {
    case "archived": return "archived";
    case "spam":     return "spam";
    case "all":      return "all";
    // For needs_review / new / engagement / sent we need both new and reviewing
    // status in the result set, so use "active" or "all" depending on whether
    // we want to include sent/archived rows.
    case "sent":         return "all"; // Sent leads are status="new"/etc. with final_sent_at populated
    default:             return "active";
  }
}

function statusFilterToPill(s: StatusFilter): Pill {
  switch (s) {
    case "archived": return "archived";
    case "spam":     return "spam";
    case "all":      return "all";
    default:         return "all"; // "active" / "hot" / "today" / etc. land in "all"
  }
}

// ── Main ──────────────────────────────────────────────────────
export default function InboxList({
  leads,
  loading,
  selectedLeadId,
  statusFilter,
  propertyFilter,
  propertyOptions,
  onStatusFilterChange,
  onPropertyFilterChange,
  onLeadsChanged,
  seedingFixture,
  seedError,
  onSeed,
}: ListProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<Pill, boolean>>({
    all: false,
    needs_review: false,
    new: false,
    engagement: true, // collapsed by default
    sent: true,
    archived: true,
    spam: true,
  });
  const [seederExpanded, setSeederExpanded] = useState(false);
  const [activePill, setActivePillState] = useState<Pill>(statusFilterToPill(statusFilter));
  const [bulkBusy, setBulkBusy] = useState(false);

  const setActivePill = useCallback(
    (p: Pill) => {
      setActivePillState(p);
      const s = pillToStatusFilter(p);
      if (s !== statusFilter) onStatusFilterChange(s);
      // When the user picks a specific section, expand it
      setCollapsed((prev) => ({ ...prev, [p]: false }));
    },
    [statusFilter, onStatusFilterChange]
  );

  // Filter by search client-side
  const visibleLeads = useMemo(
    () => leads.filter((l) => leadHas(l, search)),
    [leads, search]
  );

  // Group leads by classification
  const grouped = useMemo(() => {
    const groups: Record<Pill, LeadRow[]> = {
      all: [],
      needs_review: [],
      new: [],
      engagement: [],
      sent: [],
      archived: [],
      spam: [],
    };
    for (const l of visibleLeads) {
      const cls = classifyLead(l);
      if (cls === "other") groups.engagement.push(l);
      else groups[cls].push(l);
    }
    // sort each group by hot-first then created_at desc
    const urgencyRank = (u: string | null) =>
      u === "hot" ? 0 : u === "warm" ? 1 : u === "cold" ? 2 : 3;
    for (const k of Object.keys(groups) as Pill[]) {
      groups[k].sort((a, b) => {
        const ur = urgencyRank(a.urgency) - urgencyRank(b.urgency);
        if (ur !== 0) return ur;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }
    return groups;
  }, [visibleLeads]);

  // Counts for pill-bar badges (driven from raw leads, not search-filtered,
  // so the badge reflects total available, not current view)
  const counts = useMemo(() => {
    const out: Record<Pill, number> = {
      all: leads.length, needs_review: 0, new: 0, engagement: 0,
      sent: 0, archived: 0, spam: 0,
    };
    for (const l of leads) {
      const c = classifyLead(l);
      if (c === "other") out.engagement += 1;
      else out[c] += 1;
    }
    return out;
  }, [leads]);

  // What sections to render given the active pill
  const sectionOrder: Pill[] = useMemo(() => {
    if (activePill === "all") {
      return ["needs_review", "new", "engagement", "sent", "archived", "spam"];
    }
    return [activePill];
  }, [activePill]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInSection = (ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkUpdate = async (status: "archived" | "spam") => {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/leads/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      if (res.ok) {
        clearSelection();
        onLeadsChanged();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-baseline gap-3 px-5 pt-5 pb-2 flex-shrink-0">
        <h1 className="text-[20px] font-semibold m-0" style={{ color: C.cream }}>Inbox</h1>
        <span className="text-[11px]" style={{ color: C.charSubtle }}>
          {loading ? "loading…" : `${visibleLeads.length}${search ? ` of ${leads.length}` : ""}`}
        </span>
        <Link
          href="/agent"
          className="ml-auto text-[10.5px] py-1 px-2.5 rounded font-semibold tracking-wider uppercase no-underline"
          style={{ border: "1px solid rgba(78,205,196,0.4)", color: C.teal }}
        >
          Agent →
        </Link>
      </div>

      {/* Search */}
      <div className="px-5 pb-2 flex-shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, property…"
          className="w-full text-[12px] py-1.5 px-2.5 rounded outline-none"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: C.cream,
          }}
        />
      </div>

      {/* Pill filter row */}
      <div className="px-5 pb-2 flex flex-wrap gap-1 flex-shrink-0">
        {PILLS.map((pill) => {
          const isActive = activePill === pill.id;
          const count = counts[pill.id];
          return (
            <button
              key={pill.id}
              onClick={() => setActivePill(pill.id)}
              className="text-[10.5px] py-1 px-2 rounded font-semibold tracking-wider"
              style={{
                background: isActive ? `${pill.tint}20` : "rgba(255,255,255,0.02)",
                border: `1px solid ${isActive ? pill.tint : "rgba(255,255,255,0.08)"}`,
                color: isActive ? pill.tint : C.charMuted,
              }}
            >
              {pill.label}
              {count > 0 && (
                <span style={{ opacity: 0.6, marginLeft: 5 }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Property filter (small, compact) */}
      {propertyOptions.length > 1 && (
        <div className="px-5 pb-3 flex-shrink-0">
          <select
            value={propertyFilter}
            onChange={(e) => onPropertyFilterChange(e.target.value)}
            className="w-full text-[11px] py-1 pl-2 pr-7 rounded cursor-pointer"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: C.charMuted,
              outline: "none",
              appearance: "none",
            }}
          >
            <option value="all" style={{ background: "#1a1a1a" }}>
              All properties
            </option>
            {propertyOptions.map((p) => (
              <option key={p.id} value={p.id} style={{ background: "#1a1a1a" }}>
                {p.label} · {p.count}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Bulk action bar (sticks to top of list when active) */}
      {selectedIds.size > 0 && (
        <div
          className="flex items-center gap-2 px-5 py-2 flex-shrink-0"
          style={{
            background: "rgba(224,122,95,0.1)",
            borderTop: `1px solid ${C.coral}40`,
            borderBottom: `1px solid ${C.coral}40`,
          }}
        >
          <span className="text-[11px] font-semibold" style={{ color: C.coral }}>
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => bulkUpdate("archived")}
            disabled={bulkBusy}
            className="text-[10.5px] py-1 px-2.5 rounded font-semibold tracking-wider"
            style={{
              border: `1px solid ${C.charMuted}40`,
              color: C.cream,
              opacity: bulkBusy ? 0.5 : 1,
            }}
          >
            Archive
          </button>
          <button
            onClick={() => bulkUpdate("spam")}
            disabled={bulkBusy}
            className="text-[10.5px] py-1 px-2.5 rounded font-semibold tracking-wider"
            style={{
              border: `1px solid ${C.charMuted}40`,
              color: C.cream,
              opacity: bulkBusy ? 0.5 : 1,
            }}
          >
            Mark spam
          </button>
          <button
            onClick={clearSelection}
            className="ml-auto text-[10.5px]"
            style={{ color: C.charSubtle }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-10 text-center text-[12px]" style={{ color: C.charSubtle }}>
            Loading…
          </div>
        ) : visibleLeads.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-[26px] mb-2 opacity-30">📭</div>
            <div className="text-[12px] mb-1" style={{ color: C.charMuted }}>
              {search ? `No leads matching "${search}"` : "Nothing here yet"}
            </div>
            <div className="text-[10.5px]" style={{ color: C.charSubtle }}>
              {search
                ? "Try a different term, or clear the search."
                : "Real inbound and CSV imports will land here."}
            </div>
          </div>
        ) : (
          <>
            {sectionOrder.map((section) => {
              const items = grouped[section];
              if (!items || items.length === 0) return null;
              const meta = PILLS.find((p) => p.id === section)!;
              const isCollapsed = activePill === "all" ? collapsed[section] : false;
              const allSelected = items.every((l) => selectedIds.has(l.id));
              return (
                <div key={section}>
                  <SectionHeader
                    label={meta.label}
                    count={items.length}
                    tint={meta.tint}
                    summary={section === "engagement" ? engagementSummary(items) : null}
                    collapsed={isCollapsed}
                    onToggle={
                      activePill === "all"
                        ? () => setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }))
                        : null
                    }
                    onSelectAll={
                      items.length > 1
                        ? () => selectAllInSection(items.map((l) => l.id))
                        : null
                    }
                    allSelected={allSelected}
                  />
                  {!isCollapsed &&
                    items.map((lead) => (
                      <LeadRowItem
                        key={lead.id}
                        lead={lead}
                        selected={lead.id === selectedLeadId}
                        checked={selectedIds.has(lead.id)}
                        onToggleCheck={() => toggleSelect(lead.id)}
                        onLeadsChanged={onLeadsChanged}
                      />
                    ))}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Tucked-away seeder footer */}
      <div
        className="flex-shrink-0 px-3 py-1.5 border-t"
        style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.18)" }}
      >
        {!seederExpanded ? (
          <button
            onClick={() => setSeederExpanded(true)}
            className="text-[10px] w-full py-1"
            style={{ color: "rgba(240,237,228,0.35)", textAlign: "left" }}
          >
            ⚙ Test seeds →
          </button>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9.5px] uppercase tracking-wider font-semibold" style={{ color: C.charSubtle }}>
                Seed test lead
              </span>
              <button
                onClick={() => setSeederExpanded(false)}
                className="text-[10.5px]"
                style={{ color: C.charSubtle }}
              >✕</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {[
                { id: "crexi_buyer",       label: "CREXi" },
                { id: "loopnet_tenant",    label: "LoopNet" },
                { id: "cold_unmatched",    label: "Cold" },
                { id: "vendor_spam",       label: "Spam" },
                { id: "sms_inquiry",       label: "SMS" },
                { id: "voicemail_callback",label: "Voice" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => onSeed(f.id)}
                  disabled={seedingFixture !== null}
                  className="text-[10px] py-0.5 px-1.5 rounded"
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

// ── Engagement summary line ───────────────────────────────────
function engagementSummary(items: LeadRow[]): string {
  const stages: Record<string, number> = {};
  for (const l of items) {
    const m = (l.qualifier_summary || "").match(/CREXi engagement:\s*([^·\n]+)/i);
    const stage = (m?.[1] || l.urgency || "engaged").trim();
    stages[stage] = (stages[stage] || 0) + 1;
  }
  const ordered = Object.entries(stages).sort((a, b) => b[1] - a[1]);
  return ordered
    .slice(0, 3)
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
    .join(" · ");
}

// ── Section header ─────────────────────────────────────────────
function SectionHeader({
  label,
  count,
  tint,
  summary,
  collapsed,
  onToggle,
  onSelectAll,
  allSelected,
}: {
  label: string;
  count: number;
  tint: string;
  summary: string | null;
  collapsed: boolean;
  onToggle: (() => void) | null;
  onSelectAll: (() => void) | null;
  allSelected: boolean;
}) {
  return (
    <div
      className="flex items-baseline gap-2 px-5 pt-4 pb-1.5"
      style={{
        borderBottom: collapsed ? "1px solid rgba(255,255,255,0.04)" : "none",
      }}
    >
      <button
        onClick={onToggle ?? undefined}
        disabled={!onToggle}
        className="flex items-baseline gap-2 flex-1 text-left"
        style={{ cursor: onToggle ? "pointer" : "default" }}
      >
        <span
          className="text-[9.5px] tracking-[0.18em] uppercase font-bold"
          style={{ color: tint }}
        >
          {onToggle && (collapsed ? "▸ " : "▾ ")}
          {label}
        </span>
        <span className="text-[10px]" style={{ color: "rgba(240,237,228,0.4)" }}>
          {count}
        </span>
        {summary && collapsed && (
          <span
            className="text-[10.5px] flex-1 truncate"
            style={{ color: C.charSubtle }}
          >
            · {summary}
          </span>
        )}
      </button>
      {onSelectAll && (
        <button
          onClick={onSelectAll}
          className="text-[9.5px] uppercase tracking-wider font-semibold"
          style={{ color: C.charSubtle }}
        >
          {allSelected ? "Unselect" : "Select all"}
        </button>
      )}
    </div>
  );
}

// ── Lead row ──────────────────────────────────────────────────
function LeadRowItem({
  lead,
  selected,
  checked,
  onToggleCheck,
  onLeadsChanged,
}: {
  lead: LeadRow;
  selected: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onLeadsChanged: () => void;
}) {
  const [archiveBusy, setArchiveBusy] = useState(false);
  const cls = classifyLead(lead);
  const matched = !!lead.property;

  // Source-aware styling
  const sourceColor =
    cls === "needs_review"
      ? C.green
      : cls === "new"
      ? C.coral
      : cls === "sent"
      ? C.charMuted
      : cls === "engagement"
      ? C.teal
      : C.charSubtle;

  const muted = cls === "spam" || cls === "archived";

  const matchTag = matched
    ? { label: lead.property?.headline || lead.property?.name || "matched", color: C.green, bg: "rgba(107,203,119,0.15)" }
    : lead.property_label
    ? { label: `${lead.property_label} · review`, color: C.amber, bg: "rgba(242,201,76,0.12)" }
    : null;

  const intent = lead.intent
    ? { label: lead.intent.toUpperCase(), color: C.cream, bg: "rgba(255,255,255,0.05)" }
    : null;

  const handleArchive = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (archiveBusy) return;
    setArchiveBusy(true);
    try {
      await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived", user_action: "archive" }),
      });
      onLeadsChanged();
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleCheckbox = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleCheck();
  };

  return (
    <Link
      href={`/inbox/${lead.id}`}
      className="block group relative"
      style={{
        textDecoration: "none",
        background: selected ? "rgba(224,122,95,0.07)" : checked ? "rgba(224,122,95,0.04)" : "transparent",
        borderLeft: `3px solid ${selected ? C.coral : sourceColor}`,
        opacity: muted ? 0.55 : 1,
      }}
    >
      <div className="px-4 py-2.5 hover:bg-white/[0.02] flex items-start gap-2">
        {/* Checkbox: always there but visually subtle until hovered/checked */}
        <button
          onClick={handleCheckbox}
          className="flex-shrink-0 mt-1 transition-opacity"
          style={{
            width: 14, height: 14, borderRadius: 3,
            border: `1.5px solid ${checked ? C.coral : "rgba(255,255,255,0.18)"}`,
            background: checked ? C.coral : "transparent",
            opacity: checked ? 1 : 0.35,
            cursor: "pointer",
          }}
          aria-label={checked ? "Deselect lead" : "Select lead"}
        >
          {checked && (
            <span style={{ color: "#0d0d0d", fontSize: 9, fontWeight: 800, lineHeight: 1 }}>✓</span>
          )}
        </button>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span
              className="text-[12.5px] font-semibold flex-1 truncate"
              style={{ color: C.cream }}
            >
              {lead.sender_name || lead.sender_email || lead.sender_phone || "Anonymous"}
            </span>
            {/* Status pill */}
            {cls === "sent" ? (
              <span className="text-[9px] font-bold tracking-wider uppercase flex-shrink-0" style={{ color: C.green }}>
                ✓ Sent
              </span>
            ) : cls === "needs_review" ? (
              <span
                className="text-[8.5px] font-bold tracking-wider uppercase py-[1px] px-1 rounded flex-shrink-0"
                style={{ color: C.green, background: "rgba(107,203,119,0.13)", border: `1px solid ${C.green}40` }}
              >
                ✍ Drafted
              </span>
            ) : cls === "engagement" ? (
              <span className="text-[8.5px] font-bold tracking-wider uppercase flex-shrink-0" style={{ color: C.teal, opacity: 0.7 }}>
                CREXi
              </span>
            ) : null}
            <span className="text-[10px] flex-shrink-0" style={{ color: C.charSubtle }}>
              {timeAgo(lead.created_at)}
            </span>
          </div>

          {/* Tags row */}
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

          {/* Qualifier summary */}
          {lead.qualifier_summary && (
            <div
              className="text-[11.5px] leading-tight line-clamp-2"
              style={{ color: C.charMuted }}
            >
              {lead.qualifier_summary}
            </div>
          )}
        </div>

        {/* Hover actions */}
        <div
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1"
          style={{ minWidth: 24 }}
        >
          {!muted && (
            <button
              onClick={handleArchive}
              disabled={archiveBusy}
              className="text-[9px] py-0.5 px-1.5 rounded"
              style={{
                color: C.charMuted,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.4)",
                opacity: archiveBusy ? 0.4 : 1,
              }}
              aria-label="Archive lead"
              title="Archive"
            >
              {archiveBusy ? "…" : "Arch"}
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
