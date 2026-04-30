"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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
  draft_reply: string | null;
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

type FilterKey = "active" | "hot" | "today" | "unmatched" | "promoted" | "spam" | "archived" | "all";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "hot", label: "Hot" },
  { key: "today", label: "Today" },
  { key: "unmatched", label: "Unmatched" },
  { key: "promoted", label: "Promoted" },
  { key: "spam", label: "Spam" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
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

// ── Components ─────────────────────────────────────────────────

interface ListProps {
  selectedLeadId?: string;
}

export default function InboxList({ selectedLeadId }: ListProps) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("active");
  const [seedingFixture, setSeedingFixture] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seederExpanded, setSeederExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("leads")
      .select(`
        id, source, status, intent, urgency,
        sender_name, sender_email, sender_phone,
        property_label, qualifier_summary, raw_subject,
        draft_reply, property_id, linked_deal_id, created_at,
        property:properties(id, name, headline)
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter === "active") {
      query = query.in("status", ["new", "reviewing", "unmatched"]);
    } else if (filter === "hot") {
      query = query.eq("urgency", "hot").not("status", "in", '("spam","archived")');
    } else if (filter === "today") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      query = query.gte("created_at", todayStart.toISOString()).not("status", "in", '("spam","archived")');
    } else if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    setLeads((data as any) || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function seed(fixture: string) {
    setSeedingFixture(fixture);
    setSeedError(null);
    try {
      const res = await fetch("/api/leads/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixture }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setSeedError(body.error || `Failed (${res.status})`);
      else await load();
    } catch (e: any) {
      setSeedError(e.message || "Seed failed");
    } finally {
      setSeedingFixture(null);
    }
  }

  // ── Group leads ──────────────────────────────────────────
  const grouped = useMemo(() => {
    const out: Record<string, LeadRow[]> = { hot: [], today: [], yesterday: [], thisWeek: [], older: [] };
    for (const l of leads) {
      // Hot leads (urgency=hot, status active) get pinned at top
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
      <div className="flex items-baseline gap-3 px-5 pt-5 pb-3 flex-shrink-0">
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

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 px-5 pb-3 flex-shrink-0">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="text-[10.5px] py-1 px-2.5 rounded-full font-medium tracking-wide uppercase"
            style={{
              border: `1px solid ${filter === f.key ? "rgba(224,122,95,0.5)" : "rgba(255,255,255,0.08)"}`,
              background: filter === f.key ? "rgba(224,122,95,0.1)" : "transparent",
              color: filter === f.key ? C.coral : C.charMuted,
              cursor: "pointer",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Scrollable lead list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-5 py-10 text-center text-[12px]" style={{ color: C.charSubtle }}>Loading…</div>
        ) : leads.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-[26px] mb-2 opacity-30">📭</div>
            <div className="text-[12px] mb-1" style={{ color: C.charMuted }}>
              {filter === "active" ? "Nothing in the queue" : `No "${filter}" leads`}
            </div>
            <div className="text-[10.5px]" style={{ color: C.charSubtle }}>
              Test by seeding a synthetic lead below.
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
                  onClick={() => seed(f.id)}
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

  // Match indicator
  const matchTag = matched
    ? { label: lead.property?.headline || lead.property?.name || "matched", color: C.green, bg: "rgba(107,203,119,0.15)" }
    : lead.property_label
    ? { label: `${lead.property_label} · needs review`, color: C.amber, bg: "rgba(242,201,76,0.12)" }
    : null;

  // Intent tag
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
        {/* Top line: sender + time */}
        <div className="flex items-baseline gap-2 mb-1">
          <span
            className="text-[12.5px] font-semibold flex-1 truncate"
            style={{ color: C.cream }}
          >
            {lead.sender_name || lead.sender_email || lead.sender_phone || "Anonymous"}
          </span>
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

        {/* Summary */}
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
