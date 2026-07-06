"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * ContactCallPanel — right-side slide-over for the call list.
 *
 * Opens when the broker clicks a call-list row. Everything they need to
 * make a warm outbound call in one place:
 *
 *   1. Contact identity + property context header
 *   2. Full Gmail thread history for the contact (both directions,
 *      across all threads). Fetched live from /contacts/[id]/gmail-history.
 *   3. Prior call logs — every attempt with outcome + notes
 *   4. Log-a-call form: outcome (dropdown), duration, notes → POST
 *      /leads/[id]/log-call. Recording deferred until phone number is
 *      routed through us.
 *   5. Notes editor — separate from call notes; persists to lead.notes
 *      so it stays visible on the regular inbox view too
 *
 * Panel state is URL-driven (?leadId=<id>) so it survives navigation
 * and is deep-linkable.
 */

interface LeadPanelData {
  id: string;
  contactId: string | null;
  senderDisplay: string;
  senderPhone: string | null;
  senderEmail: string | null;
  property: { id: string; name: string; slug: string } | null;
  urgency: string | null;
  intent: string | null;
  qualifierSummary: string | null;
  rawSubject: string | null;
  notes: string | null;
}

interface GmailMessage {
  id: string;
  thread_id: string;
  date: string | null;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string;
  body_text: string;
  is_from_broker: boolean;
}

interface GmailThread {
  thread_id: string;
  subject: string;
  last_date: string | null;
  message_count: number;
  messages: GmailMessage[];
}

interface CallLog {
  id: string;
  called_at: string;
  duration_seconds: number | null;
  outcome: string;
  notes: string | null;
  channel: string | null;
}

const CALL_OUTCOMES = [
  { value: "reached", label: "Reached — spoke with them" },
  { value: "left_voicemail", label: "Left voicemail" },
  { value: "no_answer", label: "No answer / didn't leave message" },
  { value: "callback_requested", label: "Callback requested" },
  { value: "converted", label: "Converted — meeting / deal advanced" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "dead", label: "Dead — not interested" },
];

const TEXT_OUTCOMES = [
  { value: "sent", label: "Sent" },
  { value: "reply_received", label: "Reply received" },
];

export function ContactCallPanel({
  leadId,
  onClose,
}: {
  leadId: string | null;
  onClose: () => void;
}) {
  const open = leadId !== null;
  const [lead, setLead] = useState<LeadPanelData | null>(null);
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [threadsCapped, setThreadsCapped] = useState(false);
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Log-a-touch form (call or text)
  const [channel, setChannel] = useState<"call" | "text">("call");
  const [outcome, setOutcome] = useState("reached");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [logging, setLogging] = useState(false);

  // Notes editor
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);

  const reloadCalls = useCallback(async (lid: string) => {
    const r = await fetch(`/api/leads/${lid}/log-call`, { cache: "no-store" });
    const j = await r.json();
    if (Array.isArray(j?.calls)) setCalls(j.calls as CallLog[]);
  }, []);

  const reloadThreads = useCallback(async (contactId: string) => {
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const r = await fetch(`/api/contacts/${contactId}/gmail-history`, {
        cache: "no-store",
      });
      const j = await r.json();
      if (!r.ok) {
        setThreadsError(j?.error ?? `HTTP ${r.status}`);
        setThreads([]);
      } else {
        setThreads((j?.threads as GmailThread[]) ?? []);
        setThreadsCapped(!!j?.capped);
      }
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : String(err));
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!leadId) {
      setLead(null);
      setThreads([]);
      setCalls([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotesSavedAt(null);
    fetch(`/api/leads/${leadId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j?.lead && j?.error) throw new Error(j.error);
        // The leads GET route returns a snake_case row — normalize the
        // handful of fields we need for the panel. Everything else is
        // fetched separately (thread, calls).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = (j.lead ?? j) as any;
        const data: LeadPanelData = {
          id: raw.id,
          contactId: raw.contact_id ?? null,
          senderDisplay: raw.sender_name ?? raw.sender_email ?? "Unknown",
          senderPhone: raw.sender_phone ?? null,
          senderEmail: raw.sender_email ?? null,
          property: raw.property
            ? { id: raw.property.id, name: raw.property.name, slug: raw.property.slug }
            : null,
          urgency: raw.urgency ?? null,
          intent: raw.intent ?? null,
          qualifierSummary: raw.qualifier_summary ?? null,
          rawSubject: raw.raw_subject ?? null,
          notes: raw.notes ?? null,
        };
        setLead(data);
        setNotesDraft(data.notes ?? "");
        void reloadCalls(leadId);
        if (data.contactId) void reloadThreads(data.contactId);
        else setThreads([]);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, reloadCalls, reloadThreads]);

  // ESC + body scroll lock
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  async function logTouch() {
    if (!leadId) return;
    setLogging(true);
    try {
      const durationSeconds =
        channel === "call" && durationMinutes ? Math.round(Number(durationMinutes) * 60) : undefined;
      const r = await fetch(`/api/leads/${leadId}/log-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          outcome,
          duration_seconds: durationSeconds,
          notes: callNotes.trim() || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      setCallNotes("");
      setDurationMinutes("");
      await reloadCalls(leadId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setLogging(false);
    }
  }

  // When channel changes, reset outcome to a valid default for that channel
  function selectChannel(next: "call" | "text") {
    setChannel(next);
    setOutcome(next === "call" ? "reached" : "sent");
  }

  async function saveNotes() {
    if (!leadId) return;
    setNotesSaving(true);
    try {
      const r = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      setNotesSavedAt(Date.now());
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setNotesSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[105] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        className="fixed top-0 right-0 z-[106] h-full w-full max-w-xl bg-steward-base border-l border-white/[0.08] shadow-panel-soft flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] shrink-0">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            Call · Lead detail
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-white/[0.06] text-cream-dim hover:text-cream transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-5 font-body text-[13px] text-cream-dim">Loading…</div>
          )}
          {error && (
            <div className="m-5 rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
              {error}
            </div>
          )}
          {lead && !loading && (
            <div className="p-5 space-y-6">
              {/* Identity + phone */}
              <div>
                <h2 className="font-heading text-xl font-semibold text-cream">
                  {lead.senderDisplay}
                </h2>
                <div className="mt-1 font-mono text-[11.5px] text-cream-dim">
                  {[lead.property?.name, lead.intent && `intent: ${lead.intent}`, lead.urgency]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {lead.rawSubject && (
                  <p className="mt-2 font-body text-[12.5px] text-cream-dim italic">
                    Re: {lead.rawSubject}
                  </p>
                )}
                {lead.qualifierSummary && (
                  <p className="mt-2 font-body text-[13px] text-cream border-l-2 border-coral-400/40 pl-3">
                    {lead.qualifierSummary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {lead.senderPhone && (
                    <a
                      href={`tel:${lead.senderPhone}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-teal-400/50 bg-teal-400/[0.12] hover:bg-teal-400/[0.22] font-heading text-[12px] font-semibold text-teal-300 transition-colors"
                    >
                      📞 {lead.senderPhone}
                    </a>
                  )}
                  {lead.senderEmail && (
                    <a
                      href={`mailto:${lead.senderEmail}`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-mono text-[11px] text-cream-dim hover:text-cream transition-colors"
                    >
                      ✉ {lead.senderEmail}
                    </a>
                  )}
                </div>
              </div>

              {/* Log a touch — Call or Text */}
              <div className="border-t border-white/[0.06] pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
                    Log a {channel === "call" ? "call" : "text"}
                  </div>
                  {/* Channel toggle — small, tucked next to the label so
                      the log flow feels like one thing with a switch, not
                      two features stacked. */}
                  <div
                    role="tablist"
                    aria-label="Channel"
                    className="inline-flex items-center rounded border border-white/[0.08] bg-white/[0.02] p-0.5"
                  >
                    <button
                      role="tab"
                      aria-selected={channel === "call"}
                      onClick={() => selectChannel("call")}
                      className={`px-2.5 py-0.5 rounded font-mono text-[10px] uppercase tracking-eyebrow transition-colors ${
                        channel === "call"
                          ? "bg-coral-400/[0.15] text-coral-300"
                          : "text-cream-subtle hover:text-cream"
                      }`}
                    >
                      📞 Call
                    </button>
                    <button
                      role="tab"
                      aria-selected={channel === "text"}
                      onClick={() => selectChannel("text")}
                      className={`px-2.5 py-0.5 rounded font-mono text-[10px] uppercase tracking-eyebrow transition-colors ${
                        channel === "text"
                          ? "bg-coral-400/[0.15] text-coral-300"
                          : "text-cream-subtle hover:text-cream"
                      }`}
                    >
                      💬 Text
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] font-body text-[13px] text-cream focus:outline-none focus:border-coral-400/50"
                  >
                    {(channel === "call" ? CALL_OUTCOMES : TEXT_OUTCOMES).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {channel === "call" && (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      placeholder="Duration (minutes, optional)"
                      className="w-full px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] font-body text-[13px] text-cream focus:outline-none focus:border-coral-400/50"
                    />
                  )}
                  <textarea
                    value={callNotes}
                    onChange={(e) => setCallNotes(e.target.value)}
                    rows={3}
                    placeholder={
                      channel === "call"
                        ? "What happened? (optional)"
                        : "What did you text them? (optional)"
                    }
                    className="w-full px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] font-body text-[13px] text-cream focus:outline-none focus:border-coral-400/50"
                  />
                  <button
                    onClick={logTouch}
                    disabled={logging}
                    className="px-4 py-2 rounded border border-coral-400/50 bg-coral-400/[0.14] hover:bg-coral-400/[0.24] font-heading text-[11.5px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors disabled:opacity-50"
                  >
                    {logging ? "Logging…" : channel === "call" ? "Log call" : "Log text"}
                  </button>
                </div>
              </div>

              {/* Prior touches (calls + texts) */}
              {calls.length > 0 && (
                <div className="border-t border-white/[0.06] pt-4 space-y-2">
                  <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
                    Prior touches · {calls.length}
                  </div>
                  {calls.map((c) => (
                    <div key={c.id} className="rounded border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex items-baseline justify-between gap-2 font-mono text-[10.5px]">
                        <span className="text-cream">
                          {c.channel === "text" ? "💬" : "📞"} {c.outcome.replace(/_/g, " ")}
                        </span>
                        <span className="text-cream-subtle">
                          {new Date(c.called_at).toLocaleString()}
                          {c.duration_seconds ? ` · ${Math.floor(c.duration_seconds / 60)}m${c.duration_seconds % 60}s` : ""}
                        </span>
                      </div>
                      {c.notes && (
                        <p className="mt-1.5 font-body text-[12px] text-cream-dim whitespace-pre-wrap">{c.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes editor */}
              <div className="border-t border-white/[0.06] pt-4 space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
                    Notes
                  </div>
                  {notesSavedAt && Date.now() - notesSavedAt < 3000 && (
                    <span className="font-mono text-[10px] text-teal-300">Saved</span>
                  )}
                </div>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={5}
                  placeholder="General notes on this lead…"
                  className="w-full px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] font-body text-[13px] text-cream focus:outline-none focus:border-coral-400/50"
                />
                <button
                  onClick={saveNotes}
                  disabled={notesSaving || notesDraft === (lead.notes ?? "")}
                  className="px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[10.5px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {notesSaving ? "Saving…" : "Save notes"}
                </button>
              </div>

              {/* Gmail thread history */}
              <div className="border-t border-white/[0.06] pt-4 space-y-3">
                <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
                  Gmail history
                  {threadsCapped && (
                    <span className="ml-2 text-amber-300">(showing 50 most recent)</span>
                  )}
                </div>
                {threadsLoading && (
                  <p className="font-body text-[12px] text-cream-dim">Loading Gmail…</p>
                )}
                {threadsError && (
                  <div className="rounded border border-amber-400/30 bg-amber-500/[0.06] px-3 py-2 font-body text-[12px] text-amber-300">
                    {threadsError}
                  </div>
                )}
                {!threadsLoading && !threadsError && threads.length === 0 && (
                  <p className="font-body text-[12px] text-cream-dim italic">
                    No prior Gmail conversations with this contact.
                  </p>
                )}
                {threads.map((t) => (
                  <div key={t.thread_id} className="space-y-2">
                    <div className="font-heading text-[12.5px] text-cream truncate">
                      {t.subject}{" "}
                      <span className="font-mono text-[10px] text-cream-subtle">
                        · {t.message_count} msg{t.message_count === 1 ? "" : "s"}
                      </span>
                    </div>
                    {t.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded border px-3 py-2 ${
                          m.is_from_broker
                            ? "border-teal-400/20 bg-teal-400/[0.04] ml-6"
                            : "border-white/[0.06] bg-white/[0.02] mr-6"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2 font-mono text-[10px]">
                          <span className="text-cream-dim truncate">
                            {m.is_from_broker ? "You" : m.from_name ?? m.from_email ?? "?"}
                          </span>
                          <span className="text-cream-subtle shrink-0">
                            {m.date ? new Date(m.date).toLocaleString() : ""}
                          </span>
                        </div>
                        <p className="mt-1 font-body text-[12px] text-cream-dim whitespace-pre-wrap line-clamp-6">
                          {m.body_text || m.snippet}
                        </p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
