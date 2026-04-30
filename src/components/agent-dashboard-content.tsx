"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface LeadEvent {
  id: string;
  lead_id: string;
  event_type: string;
  actor: string;
  summary: string | null;
  metadata: any;
  occurred_at: string;
  lead?: { id: string; sender_name: string | null; sender_email: string | null; status: string | null; urgency: string | null } | null;
}

interface Stats {
  totalLeads: number;
  newLeads: number;
  draftsGenerated: number;
  spamFiltered: number;
  promoted: number;
  unmatched: number;
  bySource: { source: string; count: number }[];
  todayCount: number;
  weekCount: number;
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

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: C.coral,
  marginBottom: 14,
};

const statCardStyle: React.CSSProperties = {
  padding: 16,
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.05)",
  borderRadius: 6,
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeAgo(iso: string) {
  const ts = new Date(iso).getTime();
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function eventIcon(type: string): string {
  switch (type) {
    case "received": return "📨";
    case "qualified": return "🔍";
    case "matched_property": return "🏢";
    case "unmatched": return "❓";
    case "spam_flagged": return "🚫";
    case "draft_generated": return "✍️";
    case "draft_edited": return "✏️";
    case "sent": return "📤";
    case "archived": return "🗄️";
    case "promoted_to_deal": return "💼";
    case "error": return "⚠️";
    default: return "•";
  }
}

function eventColor(type: string): string {
  switch (type) {
    case "received": return C.cream;
    case "qualified": return C.teal;
    case "matched_property": return C.green;
    case "unmatched": return C.amber;
    case "spam_flagged": return "#888";
    case "draft_generated": return C.coral;
    case "promoted_to_deal": return C.green;
    case "error": return C.red;
    default: return C.charMuted;
  }
}

export default function AgentDashboardContent() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventFilter, setEventFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    // Pull leads + events in parallel
    const [{ data: leads }, { data: rawEvents }] = await Promise.all([
      supabase.from("leads").select("id, status, source, created_at, draft_reply, linked_deal_id").order("created_at", { ascending: false }),
      supabase
        .from("lead_events")
        .select(`
          id, lead_id, event_type, actor, summary, metadata, occurred_at,
          lead:leads(id, sender_name, sender_email, status, urgency)
        `)
        .order("occurred_at", { ascending: false })
        .limit(200),
    ]);

    if (leads) {
      const bySourceMap: Record<string, number> = {};
      let newCount = 0, spamCount = 0, promotedCount = 0, unmatchedCount = 0, draftCount = 0, todayCount = 0, weekCount = 0;
      for (const l of leads as any[]) {
        const src = l.source || "unknown";
        bySourceMap[src] = (bySourceMap[src] || 0) + 1;
        if (l.status === "new") newCount += 1;
        if (l.status === "spam") spamCount += 1;
        if (l.status === "promoted") promotedCount += 1;
        if (l.status === "unmatched") unmatchedCount += 1;
        if (l.draft_reply) draftCount += 1;
        const created = new Date(l.created_at).getTime();
        if (created >= todayStart.getTime()) todayCount += 1;
        if (created >= weekStart.getTime()) weekCount += 1;
      }
      const bySource = Object.entries(bySourceMap)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count);
      setStats({
        totalLeads: leads.length,
        newLeads: newCount,
        draftsGenerated: draftCount,
        spamFiltered: spamCount,
        promoted: promotedCount,
        unmatched: unmatchedCount,
        bySource,
        todayCount,
        weekCount,
      });
    }

    if (rawEvents) {
      setEvents(rawEvents as any);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const eventTypes = Array.from(new Set(events.map(e => e.event_type)));
  const filteredEvents = eventFilter === "all" ? events : events.filter(e => e.event_type === eventFilter);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", marginBottom: 22 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: C.cream }}>Agent activity</h1>
        <span style={{ fontSize: 12, color: C.charSubtle }}>
          What your AI sales employee has been doing
        </span>
        <div style={{ marginLeft: "auto" }}>
          <Link
            href="/inbox"
            style={{
              fontSize: 11.5, padding: "6px 12px", borderRadius: 6,
              border: "1px solid rgba(224,122,95,0.4)",
              color: C.coral, textDecoration: "none", fontWeight: 600, letterSpacing: "0.04em",
            }}
          >
            Inbox →
          </Link>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: C.charSubtle, fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {/* Stats grid */}
          {stats && (
            <div className="glass" style={{ padding: 18, marginBottom: 18 }}>
              <div style={sectionLabel}>This Week</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: 12,
                }}
              >
                <Stat label="Today" value={stats.todayCount} accent={C.cream} />
                <Stat label="Past 7 days" value={stats.weekCount} accent={C.teal} />
                <Stat label="Drafts generated" value={stats.draftsGenerated} accent={C.coral} />
                <Stat label="Promoted to deal" value={stats.promoted} accent={C.green} />
                <Stat label="Unmatched" value={stats.unmatched} accent={C.amber} />
                <Stat label="Spam filtered" value={stats.spamFiltered} accent="#888" />
              </div>
            </div>
          )}

          {/* Source breakdown */}
          {stats && stats.bySource.length > 0 && (
            <div className="glass" style={{ padding: 18, marginBottom: 18 }}>
              <div style={sectionLabel}>By Source</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
                {stats.bySource.map(s => (
                  <div key={s.source} style={{ minWidth: 110 }}>
                    <div style={{ fontSize: 11, color: C.charSubtle, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                      {s.source.replace(/_/g, " ")}
                    </div>
                    <div style={{ fontSize: 18, color: C.cream, fontWeight: 600 }}>{s.count}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity timeline */}
          <div className="glass" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={sectionLabel}>Activity feed</span>
              <span style={{ fontSize: 10.5, color: C.charSubtle }}>
                Last {events.length} events
              </span>
            </div>

            {/* Event filter chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              <FilterChip
                active={eventFilter === "all"}
                onClick={() => setEventFilter("all")}
                label={`All (${events.length})`}
              />
              {eventTypes.map(t => (
                <FilterChip
                  key={t}
                  active={eventFilter === t}
                  onClick={() => setEventFilter(t)}
                  label={`${eventIcon(t)} ${t.replace(/_/g, " ")}`}
                />
              ))}
            </div>

            {filteredEvents.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", fontSize: 12, color: C.charSubtle }}>
                {events.length === 0
                  ? "No agent activity yet. Send a test lead from the Inbox to see this fill up."
                  : `No "${eventFilter}" events yet`}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filteredEvents.map(ev => {
                  const lead = (ev as any).lead;
                  return (
                    <Link
                      key={ev.id}
                      href={`/inbox/${ev.lead_id}`}
                      style={{
                        display: "flex",
                        gap: 12,
                        padding: "10px 12px",
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.04)",
                        borderRadius: 4,
                        textDecoration: "none",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ fontSize: 16, lineHeight: 1, marginTop: 2 }}>{eventIcon(ev.event_type)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 3,
                              background: "rgba(255,255,255,0.04)",
                              color: eventColor(ev.event_type),
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                            }}
                          >
                            {ev.event_type.replace(/_/g, " ")}
                          </span>
                          {lead && (
                            <span style={{ fontSize: 11.5, color: C.cream }}>
                              {lead.sender_name || lead.sender_email || "Anonymous"}
                            </span>
                          )}
                          <span style={{ fontSize: 10.5, color: C.charSubtle, marginLeft: "auto" }}>
                            {ev.actor === "agent" ? "agent" : ev.actor === "user" ? "you" : "system"} · {timeAgo(ev.occurred_at)}
                          </span>
                        </div>
                        {ev.summary && (
                          <div style={{ fontSize: 12, color: C.charMuted, marginTop: 3, lineHeight: 1.45 }}>
                            {ev.summary}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={statCardStyle}>
      <div style={{ fontSize: 10, color: C.charSubtle, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, color: accent, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 10.5,
        padding: "4px 10px",
        borderRadius: 12,
        border: `1px solid ${active ? "rgba(224,122,95,0.5)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(224,122,95,0.1)" : "rgba(255,255,255,0.02)",
        color: active ? C.coral : C.charMuted,
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
        letterSpacing: "0.04em",
        textTransform: "lowercase" as const,
      }}
    >
      {label}
    </button>
  );
}
