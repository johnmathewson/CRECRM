"use client";

/**
 * CreateTaskDialog — quick-add for a task. Same generic pattern as
 * LogActivityDialog: open from any workspace, the host passes whichever
 * entity IDs apply and the dialog auto-attaches.
 *
 * Designed for speed — broker just got off a call, knows they need to
 * follow up Friday. Title autofocused; due-date defaults to Friday-of-
 * this-week (or next week if today is past Friday).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  onClose: () => void;
  propertyId?: string;
  contactId?: string;
  dealId?: string;
  /** Friendly label so the broker sees what they're tasking against. */
  contextLabel?: string;
}

type Priority = "low" | "medium" | "high" | "urgent";

const PRIORITY_OPTIONS: { value: Priority; label: string; tone: string }[] = [
  { value: "low",    label: "Low",    tone: "text-cream-subtle" },
  { value: "medium", label: "Med",    tone: "text-cream-dim" },
  { value: "high",   label: "High",   tone: "text-amber" },
  { value: "urgent", label: "Urgent", tone: "text-coral-300" },
];

/** Default due date — next Friday in local time. Most "follow up later"
 *  style tasks land mid-end of the week; saves the broker a click. */
function defaultDueDate(): string {
  const d = new Date();
  const dayOfWeek = d.getDay(); // 0=Sun
  // Days until Friday (5). If today is Saturday, push to next Friday.
  let daysToFriday = (5 - dayOfWeek + 7) % 7;
  if (daysToFriday === 0) daysToFriday = 7; // already Friday → next Friday
  d.setDate(d.getDate() + daysToFriday);
  return d.toISOString().slice(0, 10);
}

export function CreateTaskDialog({
  open,
  onClose,
  propertyId,
  contactId,
  dealId,
  contextLabel,
}: Props) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [dueDate, setDueDate] = useState<string>(defaultDueDate());
  const [dueTime, setDueTime] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate(defaultDueDate());
    setDueTime("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          due_date: dueDate || null,
          due_time: dueTime || null,
          property_id: propertyId,
          contact_id: contactId,
          deal_id: dealId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
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
        className="my-2 mx-2 lg:my-12 w-full max-w-md bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">New task</div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream truncate">
              {contextLabel ? `Against ${contextLabel}` : "Add task"}
            </h2>
          </div>
          <button onClick={onClose} className="text-cream-subtle hover:text-cream font-mono text-lg leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <Field label="Title" hint="Short imperative — 'Call Bob re: Lakeshore tour', 'Send OM to Smith Group'.">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to happen?"
              className={inputCls}
            />
          </Field>

          <Field label="Priority">
            <div className="flex gap-1">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPriority(p.value)}
                  className={`flex-1 px-2.5 py-1.5 rounded font-heading text-[10px] uppercase tracking-eyebrow font-semibold transition-colors ${
                    priority === p.value
                      ? "bg-coral-400/[0.15] text-coral-200 ring-1 ring-inset ring-coral-400/30"
                      : `bg-white/[0.04] hover:bg-white/[0.08] ${p.tone}`
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date" hint="Defaults to this Friday.">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Due time">
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Notes (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Context, attachments by link, anything else."
              className={`${inputCls} resize-y`}
            />
          </Field>

          {error && (
            <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/[0.04]">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-[12px] text-cream placeholder:text-cream-subtle";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</span>
      {hint && <span className="block mt-0.5 font-body text-[10px] text-cream-subtle">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
