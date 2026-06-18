"use client";

import { useState } from "react";

/**
 * StewardFeedback — thumbs + free-text feedback widget appended to the
 * brief. Persists to daily_briefings.feedback_thumbs / feedback_chat
 * via POST /api/agents/steward/feedback.
 *
 * Per the playbook: feedback is gathered continuously. Steward's
 * daily reflection (added in a follow-up) reads patterns from
 * the last 14 days and proposes .md edits when triggers fire.
 *
 * Thumbs cover the whole brief (single up/down) for MVP. Per-section
 * granular thumbs can be added once we have a structured reasoning
 * payload to attach them to.
 */
export function StewardFeedback({
  briefId,
  existingChat,
  existingThumbs,
}: {
  briefId: string;
  existingChat: Array<{ message: string; at: string }>;
  existingThumbs: Array<{ section: string; value: "up" | "down"; at: string }>;
}) {
  const [thumbsState, setThumbsState] = useState<"up" | "down" | null>(
    existingThumbs.find((t) => t.section === "overall")?.value ?? null
  );
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(existingChat);
  const [submitted, setSubmitted] = useState(false);

  async function submitThumbs(value: "up" | "down") {
    // Optimistic — flip the UI immediately, revert on error
    const previous = thumbsState;
    setThumbsState(value);
    setError(null);
    try {
      const r = await fetch("/api/agents/steward/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefId, type: "thumbs", section: "overall", value }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
    } catch (err) {
      setThumbsState(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitChat() {
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/agents/steward/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefId, type: "chat", message: message.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setHistory((h) => [...h, { message: message.trim(), at: new Date().toISOString() }]);
      setMessage("");
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.015] p-5 lg:p-6 space-y-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300 mb-1">
          Feedback for Steward
        </div>
        <h3 className="font-display text-[16px] text-cream">How was today&apos;s brief?</h3>
        <p className="font-body text-[11.5px] text-cream-dim mt-1 leading-relaxed">
          Thumbs flow into Steward&apos;s daily reflection. Free-text feedback (especially &ldquo;from now on&hellip;&rdquo;
          or &ldquo;stop&hellip;&rdquo;) triggers proposed playbook edits when patterns hit.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => submitThumbs("up")}
          className={`px-4 py-2 rounded border font-heading text-[11px] uppercase tracking-eyebrow font-semibold transition-colors ${
            thumbsState === "up"
              ? "border-teal-400/60 bg-teal-400/[0.15] text-teal-300"
              : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-cream-dim hover:text-cream"
          }`}
          aria-pressed={thumbsState === "up"}
        >
          👍 &nbsp; Useful
        </button>
        <button
          onClick={() => submitThumbs("down")}
          className={`px-4 py-2 rounded border font-heading text-[11px] uppercase tracking-eyebrow font-semibold transition-colors ${
            thumbsState === "down"
              ? "border-coral-400/60 bg-coral-400/[0.15] text-coral-300"
              : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] text-cream-dim hover:text-cream"
          }`}
          aria-pressed={thumbsState === "down"}
        >
          👎 &nbsp; Off
        </button>
      </div>

      <div className="space-y-2 pt-2 border-t border-white/[0.04]">
        <label className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
          Tell Steward something
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder='e.g. "From now on always include the listing broker on each property" or "stop adding emoji headers"'
          className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.08] focus:border-teal-400/40 focus:outline-none font-body text-[12px] text-cream placeholder:text-cream-subtle resize-y"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="font-body text-[10.5px] text-cream-subtle">
            Steward reads this when reflecting on the brief.
          </p>
          <button
            onClick={submitChat}
            disabled={sending || !message.trim()}
            className="px-4 py-2 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.20] disabled:opacity-40 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-teal-300"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-coral-400/40 bg-coral-400/[0.08] px-3 py-2 font-body text-[11.5px] text-coral-300">
          {error}
        </div>
      ) : null}

      {submitted ? (
        <div className="rounded border border-teal-400/40 bg-teal-400/[0.08] px-3 py-2 font-body text-[11.5px] text-teal-300">
          Got it. Steward will see this on her next reflection.
        </div>
      ) : null}

      {history.length > 0 ? (
        <details className="border-t border-white/[0.04] pt-3">
          <summary className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle cursor-pointer hover:text-cream-dim">
            Previous feedback on this brief ({history.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {history.map((h, i) => (
              <li key={i} className="rounded border border-white/[0.04] bg-white/[0.02] px-3 py-2">
                <div className="font-mono text-[9.5px] text-cream-subtle">{new Date(h.at).toLocaleString()}</div>
                <div className="font-body text-[12px] text-cream-dim mt-0.5">{h.message}</div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
