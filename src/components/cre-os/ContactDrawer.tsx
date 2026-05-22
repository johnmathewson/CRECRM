"use client";

/**
 * ContactDrawer — universal right-side slide-over for CRE OS.
 *
 * The fix for "too much clicking": instead of navigating to
 * /cre-os/inbox/[id], any lead row anywhere (Command worklist, Inbox card,
 * later Pipeline/Relationships) opens this drawer in-context. It stacks the
 * three things you act on, in one place:
 *
 *   1. Intelligence — AI extraction, sender, relationship, linked property.
 *   2. Thread       — the message timeline.
 *   3. Draft        — editable AI draft with Send / Save / Regenerate.
 *
 * Reuses the shared lead endpoints (/api/leads/[id] GET + PATCH + send +
 * draft + promote) — the same ones the full LeadDetail page uses, so the
 * two stay behavior-consistent. The full page remains the deep-link target
 * (Twilio SMS links, "Open full" button); the drawer is the in-flow path.
 *
 * Mounted once in the cre-os layout via <ContactDrawerProvider>.
 */

import {
  createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode,
} from "react";
import Link from "next/link";
import { Eyebrow } from "./Eyebrow";
import { StatusBadge } from "./StatusBadge";

// ── Shapes (from /api/leads/[id]) ───────────────────────────────────────────
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
  linked_deal_id: string | null;
  created_at: string;
  property?: {
    id: string; name: string; headline: string | null; slug: string | null;
    city: string | null; state: string | null; asking_price: number | null; asset_type: string | null;
  } | null;
  contact?: {
    id: string; full_name: string; email: string | null; phone: string | null;
    warmth: string | null; last_conversation: string | null;
  } | null;
}
interface Communication {
  id: string; channel: string; direction: string;
  subject: string | null; body_preview: string | null;
  from_address: string | null; occurred_at: string;
}

// ── Context ──────────────────────────────────────────────────────────────
interface OpenOpts { onChange?: () => void }
interface DrawerCtx {
  openLead: (leadId: string, opts?: OpenOpts) => void;
  close: () => void;
}
const Ctx = createContext<DrawerCtx | null>(null);
export function useContactDrawer(): DrawerCtx {
  return useContext(Ctx) ?? { openLead: () => {}, close: () => {} };
}

export function ContactDrawerProvider({ children }: { children: ReactNode }) {
  const [leadId, setLeadId] = useState<string | null>(null);
  const onChangeRef = useRef<(() => void) | null>(null);
  const openLead = useCallback((id: string, opts?: OpenOpts) => {
    onChangeRef.current = opts?.onChange || null;
    setLeadId(id);
  }, []);
  const close = useCallback(() => setLeadId(null), []);
  return (
    <Ctx.Provider value={{ openLead, close }}>
      {children}
      {leadId && (
        <DrawerPanel leadId={leadId} onClose={close} onChange={() => onChangeRef.current?.()} />
      )}
    </Ctx.Provider>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtMoney(n: number | null | undefined) {
  if (!n) return null;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}
function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
}
function urgencyTone(u: string | null): "coral" | "amber" | "teal" | "neutral" {
  if (u === "hot") return "coral";
  if (u === "warm") return "amber";
  if (u === "cold") return "teal";
  return "neutral";
}

// ── Panel ────────────────────────────────────────────────────────────────
function DrawerPanel({ leadId, onClose, onChange }: { leadId: string; onClose: () => void; onChange: () => void }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [thread, setThread] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "send" | "archive" | "regen" | "promote">(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setLead(data.lead);
      setThread(data.thread || []);
      setDraft(data.lead?.draft_reply || "");
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [leadId]);
  useEffect(() => { load(); }, [load]);

  const dirty = !!lead && draft !== (lead.draft_reply || "");
  const isSent = !!lead?.final_sent_at;

  async function saveDraft() {
    if (!lead) return; setBusy("save"); setMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft_reply: draft, user_action: "edit_draft" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      setMsg({ text: "Draft saved", ok: true }); await load(); onChange();
    } catch (e: any) { setMsg({ text: e.message, ok: false }); } finally { setBusy(null); }
  }
  async function regenerate() {
    if (!lead) return; setBusy("regen"); setMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Regenerate failed");
      await load(); onChange(); setMsg({ text: "Fresh draft generated", ok: true });
    } catch (e: any) { setMsg({ text: e.message, ok: false }); } finally { setBusy(null); }
  }
  async function send() {
    if (!lead) return;
    if (!lead.sender_email) { setMsg({ text: "No recipient email on this lead.", ok: false }); return; }
    if (isSent) { setMsg({ text: "Already sent.", ok: false }); return; }
    setBusy("send"); setMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirty ? { body: draft } : {}),
      });
      const d = await res.json();
      if (!res.ok) {
        if (res.status === 412) throw new Error("Gmail not connected (Settings → Integrations).");
        throw new Error(d.error || "Send failed");
      }
      setMsg({ text: "Reply sent", ok: true }); await load(); onChange();
    } catch (e: any) { setMsg({ text: e.message, ok: false }); } finally { setBusy(null); }
  }
  async function archive() {
    if (!lead) return; setBusy("archive"); setMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived", user_action: "archive" }),
      });
      if (!res.ok) throw new Error("Archive failed");
      onChange(); onClose();
    } catch (e: any) { setMsg({ text: e.message, ok: false }); setBusy(null); }
  }
  async function promote() {
    if (!lead || lead.linked_deal_id) return; setBusy("promote"); setMsg(null);
    try {
      const res = await fetch(`/api/leads/${lead.id}/promote`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Promote failed");
      setMsg({ text: "Promoted to deal", ok: true }); await load(); onChange();
    } catch (e: any) { setMsg({ text: e.message, ok: false }); } finally { setBusy(null); }
  }

  const company =
    lead?.source?.toLowerCase().includes("crexi") ? "CREXi"
    : lead?.source?.toLowerCase().includes("loopnet") ? "LoopNet"
    : lead?.source || null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[80] bg-black/55"
        style={{ backdropFilter: "blur(2px)", opacity: mounted ? 1 : 0, transition: "opacity 0.2s" }}
      />
      {/* Panel — canvas-light so the drawer matches the light content theme */}
      <aside
        className="canvas-light fixed top-0 right-0 bottom-0 z-[81] flex flex-col bg-steward-base border-l border-white/[0.08]"
        style={{
          width: "min(480px, 100vw)",
          transform: mounted ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.26s cubic-bezier(0.32,0.72,0,1)",
          boxShadow: "-12px 0 48px rgba(0,0,0,0.4)",
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-white/[0.05] shrink-0">
          <div
            className="shrink-0 flex items-center justify-center font-display font-semibold text-[13px] rounded-lg w-10 h-10"
            style={{ background: "rgba(224,122,95,0.14)", border: "1px solid rgba(224,122,95,0.3)", color: "#E8997F" }}
          >
            {initials(lead?.sender_name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-medium text-[17px] text-cream leading-tight truncate">
              {lead?.sender_name || lead?.sender_email || "Lead"}
            </div>
            <div className="font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow mt-0.5 truncate">
              {[company, lead?.intent && `intent: ${lead.intent}`].filter(Boolean).join("  ·  ")}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {lead?.urgency && <StatusBadge size="xs" tone={urgencyTone(lead.urgency)}>{lead.urgency}</StatusBadge>}
              {isSent && <StatusBadge size="xs" tone="teal">Reply sent</StatusBadge>}
              {lead?.linked_deal_id && <StatusBadge size="xs" tone="teal">Deal</StatusBadge>}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-cream-subtle hover:text-cream border border-white/[0.06] hover:bg-white/[0.04] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0 space-y-5">
          {loading ? (
            <div className="text-center py-12 font-body text-[12px] text-cream-subtle">Loading…</div>
          ) : error ? (
            <div className="font-body text-[12px] text-coral-300">{error}</div>
          ) : lead ? (
            <>
              {/* Intelligence */}
              <div>
                <Eyebrow tone="coral">Intelligence</Eyebrow>
                <div className="mt-2 rounded-md border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-2">
                  {lead.qualifier_summary && (
                    <p className="font-heading text-[13.5px] text-cream leading-snug">{lead.qualifier_summary}</p>
                  )}
                  <div className="space-y-1.5 pt-1">
                    {lead.sender_email && <Row label="Email" value={lead.sender_email} />}
                    {lead.sender_phone && <Row label="Phone" value={lead.sender_phone} />}
                    {lead.contact?.warmth && (
                      <Row label="Relationship" value={`${lead.contact.warmth}${lead.contact.last_conversation ? ` · last touch ${new Date(lead.contact.last_conversation).toLocaleDateString()}` : ""}`} />
                    )}
                    {lead.property ? (
                      <Row
                        label="Interested in"
                        value={`${lead.property.headline || lead.property.name}${lead.property.asking_price ? ` · ${fmtMoney(lead.property.asking_price)}` : ""}${lead.property.asset_type ? ` · ${lead.property.asset_type}` : ""}`}
                      />
                    ) : lead.property_label ? (
                      <Row label="Mentioned" value={`${lead.property_label} (no CRM match)`} />
                    ) : null}
                  </div>
                  {(lead.contact || lead.property) && (
                    <div className="flex gap-2 pt-1">
                      {lead.contact && (
                        <Link href={`/cre-os/relationships/${lead.contact.id}`} className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">
                          Open contact →
                        </Link>
                      )}
                      {lead.property?.slug && (
                        <Link href={`/cre-os/properties/${lead.property.slug}`} className="font-heading text-[10px] uppercase tracking-eyebrow text-teal-400 hover:text-teal-300">
                          Open listing →
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Original inbound */}
              {(lead.raw_subject || lead.raw_body) && (
                <div>
                  <Eyebrow tone="muted">Inbound</Eyebrow>
                  <div className="mt-2 rounded-md border border-white/[0.06] bg-white/[0.02] p-3.5">
                    {lead.raw_subject && <div className="font-heading text-[12px] font-semibold text-cream mb-1">{lead.raw_subject}</div>}
                    {lead.raw_body && (
                      <pre className="whitespace-pre-wrap font-body text-[11.5px] text-cream-dim leading-relaxed max-h-40 overflow-auto">{lead.raw_body}</pre>
                    )}
                  </div>
                </div>
              )}

              {/* Thread */}
              {thread.length > 0 && (
                <div>
                  <Eyebrow tone="muted">Thread · {thread.length}</Eyebrow>
                  <div className="mt-2 space-y-2">
                    {thread.map((t) => (
                      <div key={t.id} className={`p-2.5 rounded border ${t.direction === "outbound" ? "border-teal-400/20 bg-teal-400/[0.03]" : "border-white/[0.05] bg-white/[0.02]"}`}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold" style={{ color: t.direction === "inbound" ? "#4ECDC4" : "#E8997F" }}>
                            {t.direction} · {t.channel}
                          </span>
                          <span className="font-mono text-[9.5px] text-cream-subtle">{fmtTime(t.occurred_at)}</span>
                        </div>
                        {t.subject && <div className="font-body text-[11.5px] text-cream">{t.subject}</div>}
                        {t.body_preview && <div className="font-body text-[11px] text-cream-dim mt-0.5 line-clamp-3">{t.body_preview}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Draft */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Eyebrow tone="coral">{isSent ? "Reply sent" : "AI draft"}</Eyebrow>
                  {!isSent && (
                    <button
                      onClick={regenerate}
                      disabled={busy !== null}
                      className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300 disabled:opacity-50"
                    >
                      {busy === "regen" ? "Generating…" : "↻ Regenerate"}
                    </button>
                  )}
                </div>
                {isSent ? (
                  <pre className="whitespace-pre-wrap font-body text-[12px] text-cream-dim leading-relaxed rounded-md border border-white/[0.06] bg-white/[0.02] p-3.5">
                    {lead.final_reply || "(no reply body recorded)"}
                  </pre>
                ) : draft || lead.draft_reply ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={9}
                    className="w-full bg-black/20 border border-white/[0.07] rounded-md px-3.5 py-3 text-[12.5px] text-cream font-body leading-relaxed outline-none focus:border-coral-400/40 transition-colors resize-y"
                  />
                ) : (
                  <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3.5 font-body text-[11.5px] text-cream-subtle">
                    No draft yet — hit Regenerate to have the agent write one.
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Action bar */}
        {lead && !loading && (
          <div className="shrink-0 border-t border-white/[0.06] bg-black/20 px-5 py-3">
            {msg && (
              <div className={`mb-2 px-3 py-1.5 rounded font-body text-[11.5px] ${msg.ok ? "bg-teal-400/[0.08] border border-teal-400/30 text-teal-300" : "bg-coral-400/[0.08] border border-coral-400/30 text-coral-300"}`}>
                {msg.ok ? "✓ " : ""}{msg.text}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {!isSent && (
                <button
                  onClick={send}
                  disabled={busy !== null || !draft.trim()}
                  className="px-3.5 py-2 rounded bg-coral-400 hover:bg-coral-500 text-steward-base font-heading text-[11px] font-bold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
                >
                  {busy === "send" ? "Sending…" : "Send"}
                </button>
              )}
              {dirty && !isSent && (
                <button
                  onClick={saveDraft}
                  disabled={busy !== null}
                  className="px-3 py-2 rounded border border-amber/40 bg-amber/[0.06] text-amber font-heading text-[11px] font-semibold uppercase tracking-eyebrow disabled:opacity-50"
                >
                  {busy === "save" ? "…" : "Save"}
                </button>
              )}
              <button
                onClick={promote}
                disabled={busy !== null || !!lead.linked_deal_id}
                className="px-3 py-2 rounded border border-teal-400/40 bg-teal-400/[0.06] text-teal-300 hover:bg-teal-400/[0.10] font-heading text-[11px] font-semibold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
              >
                {busy === "promote" ? "…" : lead.linked_deal_id ? "Is a deal" : "Promote"}
              </button>
              <button
                onClick={archive}
                disabled={busy !== null}
                className="px-3 py-2 rounded border border-white/10 bg-white/[0.03] text-cream-dim hover:bg-white/[0.08] hover:text-cream font-heading text-[11px] font-semibold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
              >
                {busy === "archive" ? "…" : "Archive"}
              </button>
              <Link
                href={`/cre-os/inbox/${lead.id}`}
                className="ml-auto font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream"
              >
                Open full →
              </Link>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 font-body text-[11.5px]">
      <span className="shrink-0 w-[84px] text-cream-subtle">{label}</span>
      <span className="flex-1 text-cream-dim break-words">{value}</span>
    </div>
  );
}
