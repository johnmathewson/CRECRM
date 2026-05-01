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
  final_reply: string | null;
  final_sent_at: string | null;
  auto_ack_sent_at: string | null;
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
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.16em",
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

interface Props {
  leadId: string;
  /** "page" = standalone full-screen, fixed bottom action bar.
   *  "pane" = inside a flex container, sticky bottom action bar. */
  mode?: "page" | "pane";
}

export default function LeadDetailContent({ leadId, mode = "page" }: Props) {
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

  useEffect(() => { load(); }, [load]);

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

  async function send() {
    if (!lead) return;
    if (!lead.sender_email) {
      setActionMsg("This lead has no recipient email — can't send.");
      return;
    }
    if (lead.final_sent_at) {
      setActionMsg("Already sent.");
      return;
    }
    if (draftDirty && !confirm("You have unsaved edits in the draft. Send your edited text?")) {
      return;
    }
    if (!confirm(`Send this reply to ${lead.sender_email}?`)) return;
    setSaving(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftDirty ? { body: draftText } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 412) {
          setActionMsg("Gmail not connected. Connect at Settings → Integrations.");
        } else {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return;
      }
      setActionMsg("Sent ✓");
      await load();
    } catch (e: any) {
      setActionMsg(`Send failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────
  if (loading) {
    return <div className="px-6 py-12 text-center text-[12px]" style={{ color: C.charSubtle }}>Loading…</div>;
  }
  if (error || !lead) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="text-[13px] mb-3" style={{ color: C.red }}>{error || "Lead not found"}</div>
        <Link href="/inbox" className="text-[12px]" style={{ color: C.teal }}>← Back to inbox</Link>
      </div>
    );
  }

  const draftDirty = draftText !== (lead.draft_reply || "");
  const isPane = mode === "pane";

  // Outer container: in pane mode, full-height flex column with internal scroll.
  // In page mode, uses page flow + bottom padding for the fixed action bar.
  const containerClass = isPane
    ? "flex flex-col h-full overflow-hidden"
    : "pb-[100px]";

  // Scroll container: in pane mode, the inner div scrolls. In page mode, body scrolls.
  const scrollClass = isPane ? "flex-1 overflow-y-auto" : "";

  return (
    <div className={containerClass}>
      {/* ── Top bar (mobile back link in pane mode + on page mode) ─ */}
      <div
        className={`flex-shrink-0 flex items-center gap-3 px-4 lg:px-6 py-3 ${isPane ? "lg:hidden" : ""}`}
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: "rgba(0,0,0,0.18)",
        }}
      >
        <Link
          href="/inbox"
          aria-label="Back to inbox"
          className="flex items-center gap-1.5 py-2 px-3 rounded font-semibold text-[12px]"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            color: C.charMuted,
            textDecoration: "none",
            minHeight: 40,
            minWidth: 80,
          }}
        >
          <span style={{ fontSize: 14 }}>←</span>
          <span>Inbox</span>
        </Link>
      </div>

      {/* ── Scrollable content ────────────────────────────── */}
      <div className={scrollClass}>
        <div className={`px-4 lg:px-6 ${isPane ? "py-5" : "py-5 max-w-[920px] mx-auto"}`}>
          {/* Header */}
          <div className="mb-5">
            <div className="flex flex-wrap gap-2 items-center mb-2">
              {lead.urgency && <Badge label={lead.urgency} color={lead.urgency === "hot" ? C.red : lead.urgency === "cold" ? C.teal : C.amber} />}
              {lead.intent && <Badge label={lead.intent} color={C.cream} />}
              {lead.status && <Badge label={lead.status} color={C.coral} />}
            </div>
            <h1 className="text-[20px] lg:text-[22px] font-semibold m-0 leading-tight" style={{ color: C.cream }}>
              {lead.sender_name || lead.sender_email || lead.sender_phone || "Anonymous lead"}
            </h1>
            {(lead.sender_email || lead.sender_phone) && (
              <div className="text-[12px] mt-1" style={{ color: C.charSubtle }}>
                {[lead.sender_email, lead.sender_phone].filter(Boolean).join(" · ")}
              </div>
            )}
            <div className="text-[10.5px] mt-1" style={{ color: C.charSubtle }}>
              via {lead.source} · {fmtTime(lead.created_at)}
            </div>
          </div>

          {/* Status banner — reflects current send state */}
          {lead.final_sent_at ? (
            <div
              className="mb-4 px-3.5 py-2.5 rounded text-[11.5px] flex items-start gap-2"
              style={{
                background: "rgba(107,203,119,0.07)",
                border: "1px solid rgba(107,203,119,0.25)",
                color: C.charMuted,
              }}
            >
              <span style={{ color: C.green, fontSize: 14 }}>✓</span>
              <span>
                <strong style={{ color: C.cream }}>Reply sent {fmtTime(lead.final_sent_at)}.</strong>
                {" "}Sitting in {lead.sender_email}'s inbox.
              </span>
            </div>
          ) : lead.auto_ack_sent_at ? (
            <div
              className="mb-4 px-3.5 py-2.5 rounded text-[11.5px] flex items-start gap-2"
              style={{
                background: "rgba(242,201,76,0.06)",
                border: "1px solid rgba(242,201,76,0.18)",
                color: C.charMuted,
              }}
            >
              <span style={{ color: C.amber, fontSize: 14 }}>◷</span>
              <span>
                <strong style={{ color: C.cream }}>Auto-acknowledgment sent {fmtTime(lead.auto_ack_sent_at)}.</strong>
                {" "}The prospect knows you got their message. Review and send your full reply when ready.
              </span>
            </div>
          ) : (
            <div
              className="mb-4 px-3.5 py-2.5 rounded text-[11.5px] flex items-start gap-2"
              style={{
                background: "rgba(78,205,196,0.06)",
                border: "1px solid rgba(78,205,196,0.18)",
                color: C.charMuted,
              }}
            >
              <span style={{ color: C.teal, fontSize: 14 }}>ⓘ</span>
              <span>
                <strong style={{ color: C.cream }}>Draft ready — nothing sent yet.</strong>
                {" "}Review the reply below; hit Send when it reads right.
              </span>
            </div>
          )}

          {/* Match / unmatch banner */}
          <div
            className="mb-4 px-3.5 py-2.5 rounded flex items-start gap-2"
            style={{
              background: lead.property ? "rgba(107,203,119,0.07)" : "rgba(242,201,76,0.07)",
              border: `1px solid ${lead.property ? "rgba(107,203,119,0.25)" : "rgba(242,201,76,0.25)"}`,
            }}
          >
            <span style={{ fontSize: 14 }}>{lead.property ? "✓" : "⚠"}</span>
            <div className="flex-1 min-w-0">
              {lead.property ? (
                <>
                  <div className="text-[10px] font-bold tracking-wider uppercase mb-0.5" style={{ color: C.green }}>
                    Matched property
                  </div>
                  <div className="text-[13px] font-semibold" style={{ color: C.cream }}>
                    {lead.property.headline || lead.property.name}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: C.charSubtle }}>
                    {[lead.property.address, lead.property.city, lead.property.state].filter(Boolean).join(", ")}
                    {lead.property.asset_type && ` · ${lead.property.asset_type}`}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[10px] font-bold tracking-wider uppercase mb-0.5" style={{ color: C.amber }}>
                    Needs review · no CRM match
                  </div>
                  <div className="text-[12px]" style={{ color: C.charMuted }}>
                    {lead.property_label
                      ? <>Sender mentioned <em>"{lead.property_label}"</em>. The matcher couldn't tie it to a listing — could be a real listing we have or one we don't. Confirm before sending.</>
                      : "No specific property referenced. Likely a general inquiry or browsing investor."}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* AI Summary */}
          {lead.qualifier_summary && (
            <Card>
              <div style={sectionLabel}>AI Summary</div>
              <div className="text-[13px] leading-relaxed" style={{ color: C.cream }}>
                {lead.qualifier_summary}
              </div>
              {lead.claude_extraction?.notes && (
                <div className="text-[10.5px] mt-2 italic" style={{ color: C.charSubtle }}>
                  Notes: {lead.claude_extraction.notes}
                </div>
              )}
            </Card>
          )}

          {/* Thread (inbound + future replies) */}
          <Card>
            <div style={sectionLabel}>
              {thread.length > 1 ? `Thread (${thread.length})` : "Inbound message"}
            </div>
            <div className="space-y-3">
              {(thread.length > 0 ? thread : [{
                id: "_initial",
                channel: lead.source || "email",
                direction: "inbound",
                subject: lead.raw_subject,
                body_preview: lead.raw_body,
                from_address: lead.sender_email || lead.sender_phone,
                occurred_at: lead.created_at,
              }] as Communication[]).map((msg, i) => (
                <ThreadItem key={msg.id} msg={msg} isFirst={i === 0} />
              ))}
            </div>
          </Card>

          {/* Draft reply (editable) */}
          <Card>
            <div className="flex items-baseline justify-between mb-2.5">
              <span style={sectionLabel}>Draft reply</span>
              {draftDirty && (
                <span className="text-[9.5px] font-bold tracking-wider" style={{ color: C.amber }}>
                  UNSAVED
                </span>
              )}
            </div>
            {lead.draft_reply ? (
              <textarea
                value={draftText}
                onChange={e => setDraftText(e.target.value)}
                spellCheck
                className="w-full text-[13px] leading-relaxed resize-y"
                style={{
                  minHeight: 220,
                  fontFamily: "inherit",
                  color: C.cream,
                  background: "rgba(0,0,0,0.18)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 4,
                  padding: 12,
                  outline: "none",
                }}
              />
            ) : (
              <div className="text-[11.5px] italic px-3 py-2" style={{ color: C.charSubtle }}>
                No draft generated. Lead may have been flagged spam, or the drafting step errored. Check the activity log below.
              </div>
            )}
            {actionMsg && (
              <div
                className="text-[11px] mt-2"
                style={{ color: actionMsg.toLowerCase().includes("fail") ? C.red : C.teal }}
              >
                {actionMsg}
              </div>
            )}
          </Card>

          {/* Activity timeline */}
          {events.length > 0 && (
            <Card>
              <div style={sectionLabel}>Activity</div>
              <div className="space-y-2">
                {events.map(ev => (
                  <div key={ev.id} className="flex gap-2.5 items-start">
                    <span className="text-[14px] mt-[1px]">{eventIcon(ev.event_type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] leading-snug" style={{ color: C.cream }}>
                        {ev.summary}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: C.charSubtle }}>
                        {ev.actor === "agent" ? "agent" : ev.actor === "user" ? "you" : "system"} · {fmtTime(ev.occurred_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ── Action bar — sticky to pane bottom (pane mode) or fixed (page mode) ─── */}
      <div
        className={`
          ${isPane ? "flex-shrink-0" : "fixed left-0 right-0 bottom-0 z-50"}
          flex gap-2 items-center justify-center
        `}
        style={{
          padding: "12px 16px",
          background: "rgba(13,13,13,0.96)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex gap-2 w-full max-w-[920px]">
          <ActionButton variant="muted" onClick={archive} disabled={saving}>
            Archive
          </ActionButton>
          <ActionButton
            variant={draftDirty ? "teal" : "ghost"}
            onClick={saveDraft}
            disabled={saving || !draftDirty}
            className="flex-1"
          >
            {saving ? "Saving…" : "Save Draft"}
          </ActionButton>
          {lead.final_sent_at ? (
            <ActionButton variant="ghost" disabled className="flex-1" title={`Sent ${fmtTime(lead.final_sent_at)}`}>
              ✓ Sent
            </ActionButton>
          ) : (
            <ActionButton
              variant="teal"
              onClick={send}
              disabled={saving || !lead.sender_email || !lead.draft_reply}
              className="flex-1"
              title={!lead.sender_email ? "No recipient email" : !lead.draft_reply ? "No draft to send" : ""}
            >
              {saving ? "Sending…" : "Send"}
            </ActionButton>
          )}
          <ActionButton
            variant="coral"
            onClick={promote}
            disabled={saving || lead.status === "spam"}
            className="flex-1"
          >
            {lead.linked_deal_id ? "View Deal →" : "Promote"}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  const bg =
    color === C.red ? "rgba(231,76,60,0.18)"
    : color === C.amber ? "rgba(242,201,76,0.18)"
    : color === C.teal ? "rgba(78,205,196,0.18)"
    : color === C.coral ? "rgba(224,122,95,0.12)"
    : "rgba(255,255,255,0.05)";
  return (
    <span
      className="text-[9.5px] font-bold py-[2px] px-2 rounded tracking-wider uppercase"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="glass mb-4" style={{ padding: 14 }}>{children}</div>;
}

function ThreadItem({ msg, isFirst }: { msg: Communication; isFirst: boolean }) {
  const inbound = msg.direction === "inbound";
  return (
    <div
      style={{
        padding: 11,
        borderRadius: 4,
        background: inbound ? "rgba(0,0,0,0.18)" : "rgba(78,205,196,0.05)",
        border: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[11px] font-semibold" style={{ color: C.cream }}>
          {inbound ? (msg.from_address || "Sender") : "John (sent)"}
        </span>
        <span className="text-[9.5px] tracking-wider uppercase font-bold" style={{ color: inbound ? C.cream : C.teal }}>
          {msg.direction} · {msg.channel}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: C.charSubtle }}>
          {fmtTime(msg.occurred_at)}
        </span>
      </div>
      {msg.subject && (
        <div className="text-[11.5px] mb-1.5" style={{ color: C.charMuted }}>
          <strong>Subject:</strong> {msg.subject}
        </div>
      )}
      <div
        className="text-[12px] leading-relaxed whitespace-pre-wrap"
        style={{ color: C.charMuted, maxHeight: isFirst ? "none" : 200, overflow: "auto" }}
      >
        {msg.body_preview || "(empty)"}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant,
  className = "",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant: "muted" | "ghost" | "teal" | "coral" | "disabled";
  className?: string;
  title?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    muted: { border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: C.charMuted },
    ghost: { border: "1px solid rgba(255,255,255,0.06)", background: "transparent", color: C.charSubtle },
    teal: { border: "1px solid rgba(78,205,196,0.4)", background: "rgba(78,205,196,0.15)", color: C.teal },
    coral: { border: "1px solid rgba(224,122,95,0.5)", background: "rgba(224,122,95,0.15)", color: C.coral },
    disabled: { border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", color: C.charSubtle },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`text-[11.5px] font-semibold tracking-wider uppercase rounded ${className}`}
      style={{
        ...styles[variant],
        padding: "11px 14px",
        cursor: disabled ? (variant === "disabled" ? "not-allowed" : "wait") : "pointer",
        opacity: disabled && variant !== "disabled" ? 0.5 : 1,
        minHeight: 42,
        flex: variant === "muted" ? "0 0 90px" : undefined,
      }}
    >
      {children}
    </button>
  );
}
