"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PropertyHint {
  id: string;
  name: string | null;
  address: string | null;
  ownerNameRaw: string | null;
}

/**
 * SendTouchDialog — manual one-off email send.
 *
 * Used by the cold-inventory row and the prospect detail to fire a single
 * cadence-style email without waiting for the cadence runner. Lands in
 * the Prospector Inbox under status='sent'.
 */
export function SendTouchDialog({
  property,
  open,
  onClose,
}: {
  property: PropertyHint;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [toName, setToName] = useState(property.ownerNameRaw ?? "");
  const [subject, setSubject] = useState(
    `About ${property.address ?? property.name ?? "your property"}`
  );
  const [bodyText, setBodyText] = useState(
    `Hi${toName ? " " + toName.split(" ")[0] : ""},\n\nI represent Stewardship CRE in Northwest Indiana. I came across ${property.address ?? property.name} and wanted to start a brief conversation.\n\nWould you be open to a 5-minute call this week?\n\n— John Mathewson\nStewardship CRE`
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ messageId: string } | null>(null);

  if (!open) return null;

  async function send() {
    if (!to.trim()) {
      setError("Recipient email is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/lane-touches/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: property.id,
          to: to.trim(),
          toName: toName.trim() || undefined,
          subject: subject.trim(),
          bodyText,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSent({ messageId: data.gmail_message_id });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-2xl bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.05] flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-400">
              Send touch · Manual
            </div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream truncate max-w-md">
              {property.address ?? property.name}
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-cream-subtle">
              {property.ownerNameRaw ?? "—"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 p-2 text-cream-subtle hover:text-cream transition-colors"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-5 h-5">
              <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
              <line x1="6" y1="18" x2="18" y2="6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {sent ? (
          <div className="px-6 py-5 space-y-3">
            <div className="rounded border border-teal-400/30 bg-teal-400/[0.05] px-4 py-3">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300">Sent</div>
              <p className="mt-1 font-body text-[12.5px] text-cream-dim">
                Email delivered. It's now in the Prospector Inbox.
              </p>
              <p className="mt-2 font-mono text-[10px] text-cream-subtle truncate">
                Gmail msg id: {sent.messageId}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
              >
                Close
              </button>
              <a
                href="/cre-os/prospector/inbox"
                className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300"
              >
                Open Inbox →
              </a>
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-3 max-h-[80vh] overflow-y-auto">
            <Field label="To (email)">
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="owner@example.com"
                autoFocus
                className={inputCls}
              />
            </Field>
            <Field label="To (name, optional)">
              <input
                type="text"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                placeholder="Marcus Lee"
                className={inputCls}
              />
            </Field>
            <Field label="Subject">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Body">
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={10}
                className={`${inputCls} font-mono resize-y`}
              />
            </Field>

            {error && (
              <div className="rounded border border-amber/30 bg-amber/[0.08] px-3.5 py-2.5 font-body text-[12px] text-amber">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.04]">
              <button
                onClick={onClose}
                className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
              >
                Cancel
              </button>
              <button
                onClick={send}
                disabled={busy}
                className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40"
              >
                {busy ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
