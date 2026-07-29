"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ThreadPanel — tap a stream row, get the conversation with that person and
 * a reply bar, without leaving Communications.
 *
 * Two modes, one experience:
 *   - lead mode (leadId): thread + reply via the existing lead routes.
 *   - contact mode (contactId, no lead yet — cold prospects, brokers):
 *     thread loads from /api/contacts/[id]/thread; the FIRST send calls
 *     /api/contacts/[id]/ensure-lead to mint the conversation container,
 *     then hands off to the same lead routes. From John's seat there is
 *     no difference: tap person → read → reply.
 *
 * All sends go through the lead routes (/send, /send-sms, /draft) — those
 * stamp final_sent_at / status and write the outbound comms row, which is
 * what clears Unanswered everywhere. No new send paths.
 */

interface ThreadMsg {
  id: string;
  direction: string;
  channel: string | null;
  subject: string | null;
  body_preview: string | null;
  from_address: string | null;
  occurred_at: string;
}

interface PanelData {
  leadId: string | null;
  who: string;
  senderEmail: string | null;
  senderPhone: string | null;
  draftReply: string | null;
  propertyName: string | null;
  thread: ThreadMsg[];
}

type ReplyChannel = "sms" | "email";

const CHANNEL_GLYPH: Record<string, string> = {
  email: "✉", sms: "▣", phone: "☎", website: "◆",
};

export function ThreadPanel({
  leadId,
  contactId,
  initialChannel,
  onClose,
}: {
  leadId?: string | null;
  contactId?: string | null;
  /** Channel of the row that was tapped — reply defaults in kind */
  initialChannel: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [effLeadId, setEffLeadId] = useState<string | null>(leadId ?? null);
  const [data, setData] = useState<PanelData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replyChannel, setReplyChannel] = useState<ReplyChannel | null>(null);
  const [text, setText] = useState("");
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const loadThread = useCallback(
    async (id: string | null) => {
      try {
        if (id) {
          const res = await fetch(`/api/leads/${id}`);
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || "Failed to load thread");
          setData({
            leadId: id,
            who:
              json.lead?.contact?.full_name ||
              json.lead?.sender_name ||
              json.lead?.sender_email ||
              json.lead?.sender_phone ||
              "Unknown",
            senderEmail: json.lead?.sender_email ?? json.lead?.contact?.email ?? null,
            senderPhone: json.lead?.sender_phone ?? json.lead?.contact?.phone ?? null,
            draftReply: json.lead?.draft_reply ?? null,
            propertyName: json.lead?.property?.name ?? null,
            thread: json.thread ?? [],
          });
        } else if (contactId) {
          const res = await fetch(`/api/contacts/${contactId}/thread`);
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || "Failed to load thread");
          // The contact's history may already reference a lead — upgrade to
          // lead mode so drafts + the lead file link light up.
          if (json.leadId) {
            setEffLeadId(json.leadId);
            return;
          }
          setData({
            leadId: null,
            who: json.contact?.full_name || json.contact?.email || json.contact?.phone || "Unknown",
            senderEmail: json.contact?.email ?? null,
            senderPhone: json.contact?.phone ?? null,
            draftReply: null,
            propertyName: null,
            thread: json.thread ?? [],
          });
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load thread");
      }
    },
    [contactId]
  );

  useEffect(() => {
    loadThread(effLeadId);
  }, [effLeadId, loadThread]);

  // Pick the reply channel once data arrives: reply in kind, fall back to
  // whichever address we actually have.
  useEffect(() => {
    if (!data || replyChannel) return;
    const hasPhone = !!data.senderPhone;
    const hasEmail = !!data.senderEmail;
    const preferred: ReplyChannel = initialChannel === "email" ? "email" : "sms";
    const chosen: ReplyChannel | null =
      preferred === "sms" && hasPhone ? "sms"
      : preferred === "email" && hasEmail ? "email"
      : hasPhone ? "sms"
      : hasEmail ? "email"
      : null;
    setReplyChannel(chosen);
  }, [data, replyChannel, initialChannel]);

  // Pre-load the AI draft into the email composer (once, and only if the
  // user hasn't typed anything).
  useEffect(() => {
    if (!data || draftLoaded) return;
    if (replyChannel === "email" && data.draftReply && !text) {
      setText(data.draftReply);
      setDraftLoaded(true);
    }
  }, [data, replyChannel, draftLoaded, text]);

  function switchChannel(ch: ReplyChannel) {
    if (ch === replyChannel) return;
    setReplyChannel(ch);
    setNotice(null);
    // Email gets the AI draft; texts start blank (drafts are email-length).
    if (ch === "email" && data?.draftReply) {
      setText(data.draftReply);
      setDraftLoaded(true);
    } else {
      setText("");
    }
  }

  /** Contact mode → mint the lead that carries this conversation. */
  async function ensureLead(): Promise<string | null> {
    if (effLeadId) return effLeadId;
    if (!contactId) return null;
    const res = await fetch(`/api/contacts/${contactId}/ensure-lead`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Could not open a conversation for this contact");
    setEffLeadId(json.leadId as string);
    return json.leadId as string;
  }

  async function send() {
    if (!text.trim() || !replyChannel || !data) return;
    setBusy("send");
    setNotice(null);
    try {
      const id = await ensureLead();
      if (!id) throw new Error("No lead or contact to send through");
      const url = replyChannel === "sms"
        ? `/api/leads/${id}/send-sms`
        : `/api/leads/${id}/send`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Send failed");
      setText("");
      setDraftLoaded(true); // don't re-inject the draft after sending
      setNotice({ kind: "ok", msg: replyChannel === "sms" ? "Text sent" : "Email sent" });
      await loadThread(id);
      router.refresh(); // stream rows + Unanswered recompute server-side
    } catch (e) {
      setNotice({ kind: "err", msg: e instanceof Error ? e.message : "Send failed" });
    } finally {
      setBusy(null);
    }
  }

  async function regenerateDraft() {
    setBusy("draft");
    setNotice(null);
    try {
      const id = await ensureLead();
      if (!id) throw new Error("No lead or contact to draft for");
      const res = await fetch(`/api/leads/${id}/draft`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Drafter failed");
      const fresh = (json?.draft_reply as string) ?? null;
      if (fresh) setText(fresh);
      else {
        // Route may not echo the draft — pull it from the refetched lead
        const res2 = await fetch(`/api/leads/${id}`);
        const json2 = await res2.json();
        if (json2?.lead?.draft_reply) setText(json2.lead.draft_reply);
      }
      setDraftLoaded(true);
      setNotice({ kind: "ok", msg: "Fresh draft ready — edit and send" });
      await loadThread(id);
    } catch (e) {
      setNotice({ kind: "err", msg: e instanceof Error ? e.message : "Drafter failed" });
    } finally {
      setBusy(null);
    }
  }

  const who = data?.who ?? "…";

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} />

      {/* Sheet — bottom on mobile, right-side on desktop */}
      <div className="absolute inset-x-0 bottom-0 top-14 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[480px] flex flex-col bg-steward-base border-t lg:border-t-0 lg:border-l border-white/10 rounded-t-xl lg:rounded-none shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
          <div className="min-w-0">
            <div className="font-heading text-[15px] font-bold text-cream truncate">{who}</div>
            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-cream-subtle">
              {data?.propertyName && (
                <span className="px-1.5 py-0.5 rounded-full bg-teal-400/[0.08] border border-teal-400/25 text-teal-300">
                  {data.propertyName}
                </span>
              )}
              {effLeadId ? (
                <a href={`/cre-os/inbox/${effLeadId}`} className="underline underline-offset-2 hover:text-cream-dim">
                  Open lead file →
                </a>
              ) : contactId ? (
                <a href={`/cre-os/relationships/${contactId}`} className="underline underline-offset-2 hover:text-cream-dim">
                  Open contact →
                </a>
              ) : null}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close thread"
            className="shrink-0 w-8 h-8 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-cream-dim font-mono text-[14px]"
          >
            ✕
          </button>
        </div>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loadError && (
            <p className="font-body text-[12px] text-coral-300 py-4">{loadError}</p>
          )}
          {!data && !loadError && (
            <p className="font-body text-[12px] text-cream-subtle py-4">Loading conversation…</p>
          )}
          {data && data.thread.length === 0 && (
            <p className="font-body text-[12px] text-cream-subtle py-4">
              No messages logged yet with this person.
            </p>
          )}
          {data?.thread.map((m) => {
            const outbound = m.direction === "outbound";
            return (
              <div
                key={m.id}
                className={`max-w-[85%] p-2.5 rounded-lg border ${
                  outbound
                    ? "ml-auto border-teal-400/20 bg-teal-400/[0.05]"
                    : "mr-auto border-white/[0.06] bg-white/[0.03]"
                }`}
              >
                <div className="flex items-baseline justify-between gap-3 mb-0.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-cream-subtle">
                    {CHANNEL_GLYPH[m.channel ?? ""] ?? "•"} {outbound ? "You" : who}
                  </span>
                  <span className="font-mono text-[9px] text-cream-subtle shrink-0">
                    {new Date(m.occurred_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </div>
                {m.subject && <div className="font-body text-[12px] text-cream leading-snug">{m.subject}</div>}
                {m.body_preview && (
                  <p className="font-body text-[12px] text-cream-dim leading-snug whitespace-pre-wrap">
                    {m.body_preview}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Reply bar */}
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-2 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]">
          {notice && (
            <div className={`px-3 py-1.5 rounded font-body text-[12px] ${
              notice.kind === "ok"
                ? "bg-teal-400/[0.08] border border-teal-400/30 text-teal-300"
                : "bg-coral-400/[0.08] border border-coral-400/30 text-coral-300"
            }`}>
              {notice.kind === "ok" ? "✓ " : ""}{notice.msg}
            </div>
          )}

          {data && !data.senderPhone && !data.senderEmail ? (
            <p className="font-body text-[12px] text-cream-subtle">
              No phone or email on file for this person — nothing to reply to.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {data?.senderPhone && (
                  <ChannelTab
                    label={`Text ${data.senderPhone}`}
                    active={replyChannel === "sms"}
                    onClick={() => switchChannel("sms")}
                  />
                )}
                {data?.senderEmail && (
                  <ChannelTab
                    label={`Email ${data.senderEmail}`}
                    active={replyChannel === "email"}
                    onClick={() => switchChannel("email")}
                  />
                )}
                {replyChannel === "email" && (
                  <button
                    onClick={regenerateDraft}
                    disabled={!!busy}
                    className="ml-auto font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300 disabled:opacity-50"
                  >
                    {busy === "draft" ? "Drafting…" : "AI draft"}
                  </button>
                )}
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={replyChannel === "email" ? 6 : 3}
                maxLength={replyChannel === "sms" ? 1600 : undefined}
                placeholder={
                  replyChannel === "sms"
                    ? "Text from (317) 804-1980…"
                    : "Reply by email — tap AI draft to have one written…"
                }
                className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-2.5 font-body text-base lg:text-[13px] text-cream placeholder:text-cream-subtle focus:border-teal-400/40 focus:outline-none resize-y"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] text-cream-subtle">
                  {replyChannel === "sms" && text.length > 0 &&
                    `${text.length} chars · ${Math.ceil(text.length / 160)} segment${text.length > 160 ? "s" : ""}`}
                </span>
                <button
                  onClick={send}
                  disabled={!!busy || !text.trim() || !replyChannel}
                  className="px-5 py-2.5 rounded bg-coral-400 hover:bg-coral-500 text-steward-base font-heading text-[12px] font-bold uppercase tracking-eyebrow disabled:opacity-50 transition-colors"
                >
                  {busy === "send" ? "Sending…" : replyChannel === "sms" ? "Send text" : "Send email"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border font-heading text-[10px] uppercase tracking-eyebrow transition-colors truncate max-w-[46%] ${
        active
          ? "border-teal-400 bg-teal-400/[0.12] text-teal-300"
          : "border-white/10 bg-white/[0.03] text-cream-dim hover:bg-white/[0.06]"
      }`}
    >
      {label}
    </button>
  );
}
