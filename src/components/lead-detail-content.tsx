"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────
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
  notes: string | null;
  linked_deal_id: string | null;
  property_id: string | null;
  contact_id: string | null;
  created_at: string;
  property?: { id: string; name: string; headline: string | null; address: string | null; city: string | null; state: string | null; slug: string | null; asking_price: number | null; lease_rate: number | null; asset_type: string | null } | null;
  contact?: { id: string; full_name: string; email: string | null; phone: string | null; warmth: string | null; last_conversation: string | null } | null;
  claude_extraction?: any;
}

interface LeadEvent {
  id: string;
  event_type: string;
  actor: string;
  summary: string | null;
  metadata: any;
  occurred_at: string;
}

interface Communication {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body_preview: string | null;
  from_address: string | null;
  occurred_at: string;
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
  marginBottom: 10,
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

export default function LeadDetailContent({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [thread, setThread] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setLead(data.lead);
      setEvents(data.events || []);
      setThread(data.thread || []);
      setDraftText(data.lead?.draft_reply || "");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDraft() {
    if (!lead) return;
    setSaving(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_reply: draftText, user_action: "edit_draft" }),
      });
      if (!res.ok) {
        const b = await res.json();
        throw new Error(b.error);
      }
      setActionMsg("Draft saved");
      await load();
    } catch (e: any) {
      setActionMsg(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!lead) return;
    if (!confirm("Archive this lead?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived", user_action: "archive" }),
      });
      if (!res.ok) throw new Error("Archive failed");
      router.push("/inbox");
    } catch (e: any) {
      setActionMsg(e.message);
      setSaving(false);
    }
  }

  async function promote() {
    if (!lead) return;
    if (lead.linked_deal_id) {
      router.push(`/deals`);
      return;
    }
    if (!confirm("Promote this lead into a deal?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/deals");
    } catch (e: any) {
      setActionMsg(`Promote failed: ${e.message}`);
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: C.charSubtle }}>Loading…</div>;
  }
  if (error || !lead) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{error || "Lead not found"}</div>
        <Link href="/inbox" style={{ color: C.teal, fontSize: 12 }}>← Back to inbox</Link>
      </div>
    );
  }

  const draftDirty = draftText !== (lead.draft_reply || "");

  return (
    <>
      {/* Back link */}
      <Link
        href="/inbox"
        style={{
          fontSize: 11,
          color: C.charSubtle,
          textDecoration: "none",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontWeight: 500,
          display: "inline-block",
          marginBottom: 16,
        }}
      >
        ← Inbox
      </Link>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          {lead.urgency && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
              background: lead.urgency === "hot" ? "rgba(231,76,60,0.18)" : lead.urgency === "cold" ? "rgba(78,205,196,0.18)" : "rgba(242,201,76,0.18)",
              color: lead.urgency === "hot" ? C.red : lead.urgency === "cold" ? C.teal : C.amber,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>{lead.urgency}</span>
          )}
          {lead.intent && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
              background: "rgba(255,255,255,0.05)", color: C.cream,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>{lead.intent}</span>
          )}
          {lead.status && (
            <span style={{
              fontSize: 9.5, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
              background: "rgba(224,122,95,0.12)", color: C.coral,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>{lead.status}</span>
          )}
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: C.cream, lineHeight: 1.3 }}>
          {lead.sender_name || lead.sender_email || lead.sender_phone || "Anonymous lead"}
        </h1>
        {(lead.sender_email || lead.sender_phone) && (
          <div style={{ fontSize: 12, color: C.charSubtle, marginTop: 4 }}>
            {[lead.sender_email, lead.sender_phone].filter(Boolean).join(" · ")}
          </div>
        )}
        <div style={{ fontSize: 11, color: C.charSubtle, marginTop: 4 }}>
          via {lead.source} · {fmtTime(lead.created_at)}
        </div>
      </div>

      {/* AI Summary */}
      {lead.qualifier_summary && (
        <div className="glass" style={{ padding: 16, marginBottom: 16, borderLeft: "3px solid " + C.teal }}>
          <div style={sectionLabel}>AI Summary</div>
          <div style={{ fontSize: 13, color: C.cream, lineHeight: 1.5 }}>{lead.qualifier_summary}</div>
          {lead.claude_extraction?.notes && (
            <div style={{ fontSize: 11, color: C.charSubtle, marginTop: 8, fontStyle: "italic" }}>
              Notes: {lead.claude_extraction.notes}
            </div>
          )}
        </div>
      )}

      {/* Property match */}
      <div className="glass" style={{ padding: 16, marginBottom: 16 }}>
        <div style={sectionLabel}>Property</div>
        {lead.property ? (
          <div>
            <Link
              href="/properties"
              style={{ fontSize: 14, fontWeight: 600, color: C.cream, textDecoration: "none" }}
            >
              {lead.property.headline || lead.property.name}
            </Link>
            <div style={{ fontSize: 11, color: C.charSubtle, marginTop: 4 }}>
              {[lead.property.address, lead.property.city, lead.property.state].filter(Boolean).join(", ")}
              {lead.property.asset_type && ` · ${lead.property.asset_type}`}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: C.amber, marginBottom: 4 }}>
              {lead.property_label ? `Mentioned: "${lead.property_label}"` : "No property reference"}
            </div>
            <div style={{ fontSize: 11, color: C.charSubtle }}>
              No matching listing in the CRM. Manually link from a listing page (coming soon) or treat as off-market.
            </div>
          </div>
        )}
      </div>

      {/* Inbound message */}
      <div className="glass" style={{ padding: 16, marginBottom: 16 }}>
        <div style={sectionLabel}>Inbound Message</div>
        {lead.raw_subject && (
          <div style={{ fontSize: 12, color: C.charMuted, marginBottom: 8 }}>
            <strong>Subject:</strong> {lead.raw_subject}
          </div>
        )}
        <div
          style={{
            fontSize: 12.5,
            color: C.charMuted,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            background: "rgba(0,0,0,0.18)",
            padding: 12,
            borderRadius: 4,
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          {lead.raw_body || "(empty body)"}
        </div>
      </div>

      {/* Draft reply (editable) */}
      <div className="glass" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={sectionLabel}>Draft Reply</span>
          {draftDirty && (
            <span style={{ fontSize: 10, color: C.amber, fontWeight: 600 }}>UNSAVED CHANGES</span>
          )}
        </div>

        {lead.draft_reply ? (
          <textarea
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            spellCheck
            style={{
              width: "100%",
              minHeight: 220,
              fontFamily: "inherit",
              fontSize: 13,
              lineHeight: 1.55,
              color: C.cream,
              background: "rgba(0,0,0,0.18)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 4,
              padding: 12,
              resize: "vertical",
              outline: "none",
            }}
          />
        ) : (
          <div style={{ fontSize: 12, color: C.charSubtle, fontStyle: "italic", padding: 12 }}>
            No draft generated. Lead may have been flagged spam, or the drafting step errored. Check the activity log below.
          </div>
        )}

        {actionMsg && (
          <div style={{ fontSize: 11.5, color: actionMsg.includes("failed") ? C.red : C.teal, marginTop: 8 }}>
            {actionMsg}
          </div>
        )}
      </div>

      {/* Activity timeline */}
      {events.length > 0 && (
        <div className="glass" style={{ padding: 16, marginBottom: 16 }}>
          <div style={sectionLabel}>Activity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {events.map(ev => (
              <div key={ev.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ fontSize: 14, marginTop: 1 }}>{eventIcon(ev.event_type)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: C.cream, lineHeight: 1.4 }}>
                    {ev.summary}
                    <span style={{ color: C.charSubtle, marginLeft: 8, fontSize: 10.5 }}>
                      {ev.actor === "agent" ? "agent" : ev.actor === "user" ? "you" : "system"} · {fmtTime(ev.occurred_at)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky action bar */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "12px 20px",
          background: "rgba(13,13,13,0.96)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
          zIndex: 50,
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8, maxWidth: 920, width: "100%" }}>
          <button
            onClick={archive}
            disabled={saving}
            style={{
              flex: "0 1 100px",
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: C.charMuted,
              borderRadius: 4,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            Archive
          </button>
          <button
            onClick={saveDraft}
            disabled={saving || !draftDirty}
            style={{
              flex: 1,
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              border: "1px solid rgba(78,205,196,0.4)",
              background: draftDirty ? "rgba(78,205,196,0.15)" : "transparent",
              color: draftDirty ? C.teal : C.charSubtle,
              borderRadius: 4,
              cursor: saving || !draftDirty ? "not-allowed" : "pointer",
              opacity: saving || !draftDirty ? 0.5 : 1,
            }}
          >
            {saving ? "Saving…" : "Save Draft"}
          </button>
          <button
            disabled
            title="Gmail send wires up in Slice C"
            style={{
              flex: 1,
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.03)",
              color: C.charSubtle,
              borderRadius: 4,
              cursor: "not-allowed",
            }}
          >
            Send (soon)
          </button>
          <button
            onClick={promote}
            disabled={saving || lead.status === "spam"}
            style={{
              flex: 1,
              padding: "10px 14px",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              border: "1px solid rgba(224,122,95,0.5)",
              background: "rgba(224,122,95,0.15)",
              color: C.coral,
              borderRadius: 4,
              cursor: saving ? "wait" : "pointer",
              opacity: saving ? 0.5 : 1,
            }}
          >
            {lead.linked_deal_id ? "View Deal →" : "Promote to Deal"}
          </button>
        </div>
      </div>
    </>
  );
}
