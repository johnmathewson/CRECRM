"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────
interface Lead {
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
  raw_body: string | null;
  draft_reply: string | null;
  linked_deal_id: string | null;
  property_id: string | null;
  contact_id: string | null;
  created_at: string;
  property?: { id: string; name: string; headline: string | null; slug: string | null } | null;
  contact?: { id: string; full_name: string } | null;
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

const URGENCY_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  hot: { bg: "rgba(231,76,60,0.18)", fg: C.red, label: "Hot" },
  warm: { bg: "rgba(242,201,76,0.18)", fg: C.amber, label: "Warm" },
  cold: { bg: "rgba(78,205,196,0.18)", fg: C.teal, label: "Cold" },
};

const STATUS_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  new: { bg: "rgba(224,122,95,0.18)", fg: C.coral, label: "New" },
  reviewing: { bg: "rgba(78,205,196,0.18)", fg: C.teal, label: "Reviewing" },
  unmatched: { bg: "rgba(242,201,76,0.18)", fg: C.amber, label: "Unmatched" },
  spam: { bg: "rgba(120,120,120,0.18)", fg: "#999", label: "Spam" },
  archived: { bg: "rgba(120,120,120,0.18)", fg: "#999", label: "Archived" },
  promoted: { bg: "rgba(107,203,119,0.18)", fg: C.green, label: "Promoted" },
  sent: { bg: "rgba(107,203,119,0.18)", fg: C.green, label: "Sent" },
};

const SOURCE_ICON: Record<string, string> = {
  email: "✉️",
  sms: "💬",
  voice: "📞",
  website: "🌐",
  manual_test: "🧪",
};

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

type FilterKey = "active" | "all" | "new" | "unmatched" | "spam" | "archived" | "promoted";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "new", label: "New" },
  { key: "unmatched", label: "Unmatched" },
  { key: "promoted", label: "Promoted" },
  { key: "spam", label: "Spam" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

export default function InboxContent() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("active");
  const [seedingFixture, setSeedingFixture] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from("leads")
      .select(`
        id, source, status, intent, urgency,
        sender_name, sender_email, sender_phone,
        property_label, qualifier_summary, raw_subject, raw_body,
        draft_reply, linked_deal_id, property_id, contact_id, created_at,
        property:properties(id, name, headline, slug),
        contact:contacts(id, full_name)
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (filter === "active") {
      query = query.in("status", ["new", "reviewing", "unmatched"]);
    } else if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      setLeads([]);
    } else {
      setLeads((data as any) || []);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function seed(fixture?: string) {
    setSeedingFixture(fixture || "random");
    setSeedError(null);
    try {
      const res = await fetch("/api/leads/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fixture ? { fixture } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSeedError(body.error || `Failed (${res.status})`);
      } else {
        await load();
      }
    } catch (e: any) {
      setSeedError(e.message || "Seed failed");
    } finally {
      setSeedingFixture(null);
    }
  }

  const counts = leads.length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: C.cream }}>Inbox</h1>
        <span style={{ fontSize: 12, color: C.charSubtle }}>
          {loading ? "loading…" : `${counts} ${counts === 1 ? "lead" : "leads"}`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Link
            href="/agent"
            style={{
              fontSize: 11.5,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid rgba(78,205,196,0.4)",
              color: C.teal,
              textDecoration: "none",
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            Agent activity →
          </Link>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              fontSize: 11.5,
              padding: "6px 12px",
              borderRadius: 14,
              border: `1px solid ${filter === f.key ? "rgba(224,122,95,0.5)" : "rgba(255,255,255,0.08)"}`,
              background: filter === f.key ? "rgba(224,122,95,0.1)" : "rgba(255,255,255,0.02)",
              color: filter === f.key ? C.coral : C.charMuted,
              cursor: "pointer",
              fontWeight: filter === f.key ? 600 : 400,
              letterSpacing: "0.04em",
              textTransform: "uppercase" as const,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Test seed — visible until we have real Gmail/Twilio wiring */}
      <div
        className="glass"
        style={{
          padding: "12px 16px",
          marginBottom: 18,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          fontSize: 12,
          color: C.charMuted,
        }}
      >
        <span style={{ fontWeight: 600, color: C.cream }}>Test the agent:</span>
        {[
          { id: "crexi_buyer", label: "CREXi buyer" },
          { id: "loopnet_tenant", label: "LoopNet tenant" },
          { id: "cold_unmatched", label: "Cold / unmatched" },
          { id: "vendor_spam", label: "Vendor spam" },
          { id: "sms_inquiry", label: "SMS" },
          { id: "voicemail_callback", label: "Voicemail" },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => seed(f.id)}
            disabled={seedingFixture !== null}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: C.charMuted,
              cursor: seedingFixture !== null ? "wait" : "pointer",
              opacity: seedingFixture && seedingFixture !== f.id ? 0.4 : 1,
            }}
          >
            {seedingFixture === f.id ? "running…" : f.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: C.charSubtle }}>
          Synthetic leads — POST /api/leads/test
        </span>
      </div>
      {seedError && (
        <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{seedError}</div>
      )}

      {/* Cards */}
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: C.charSubtle, fontSize: 13 }}>Loading…</div>
      ) : leads.length === 0 ? (
        <div className="glass" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>📭</div>
          <div style={{ fontSize: 13, color: C.charMuted, marginBottom: 6 }}>
            {filter === "active" ? "Nothing in the active queue" : `No leads matching "${filter}"`}
          </div>
          <div style={{ fontSize: 11, color: C.charSubtle }}>
            Test by clicking one of the seed buttons above, or wait for a real inbound (Gmail / Twilio coming in Slice C+).
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {leads.map(lead => {
            const urgency = URGENCY_STYLES[lead.urgency || "warm"] || URGENCY_STYLES.warm;
            const status = STATUS_STYLES[lead.status || "new"] || { bg: "rgba(255,255,255,0.05)", fg: "#888", label: lead.status || "—" };
            const sourceIcon = SOURCE_ICON[lead.source || "email"] || "📨";

            return (
              <Link
                key={lead.id}
                href={`/inbox/${lead.id}`}
                className="glass"
                style={{
                  padding: 14,
                  textDecoration: "none",
                  display: "block",
                  transition: "all 0.15s",
                  borderLeft: `3px solid ${urgency.fg}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ fontSize: 18, marginTop: 1 }}>{sourceIcon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.cream }}>
                        {lead.sender_name || lead.sender_email || lead.sender_phone || "Anonymous"}
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 3,
                          background: status.bg,
                          color: status.fg,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        {status.label}
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: "2px 7px",
                          borderRadius: 3,
                          background: urgency.bg,
                          color: urgency.fg,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        {urgency.label}
                      </span>
                      <span style={{ fontSize: 10.5, color: C.charSubtle, marginLeft: "auto" }}>
                        {timeAgo(lead.created_at)}
                      </span>
                    </div>

                    {lead.property?.name && (
                      <div style={{ fontSize: 11, color: C.teal, marginBottom: 4 }}>
                        ▸ {lead.property.headline || lead.property.name}
                      </div>
                    )}
                    {!lead.property && lead.property_label && (
                      <div style={{ fontSize: 11, color: C.amber, marginBottom: 4 }}>
                        ▸ {lead.property_label} (no CRM match)
                      </div>
                    )}

                    {lead.qualifier_summary && (
                      <div style={{ fontSize: 12, color: C.charMuted, marginBottom: 4, lineHeight: 1.45 }}>
                        {lead.qualifier_summary}
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: C.charSubtle, lineHeight: 1.4 }}>
                      {lead.raw_subject && (
                        <span style={{ fontStyle: "italic" }}>"{lead.raw_subject}"</span>
                      )}
                      {lead.raw_subject && lead.draft_reply && " · "}
                      {lead.draft_reply && (
                        <span>Draft ready ({lead.draft_reply.length} chars)</span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
