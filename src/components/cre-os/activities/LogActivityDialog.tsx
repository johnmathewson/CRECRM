"use client";

/**
 * LogActivityDialog — quick-capture for call / meeting / tour / note / etc.
 *
 * Generic: same component on the property workspace, contact workspace,
 * and deal workspace. The host passes whichever entity IDs apply (one
 * required); the dialog auto-attaches the activity to those entities
 * via /api/activities.
 *
 * Designed for speed — broker just got off a call, wants to drop a note
 * in 10 seconds. Type defaults to "call" (most common); subject is
 * autofocused; date+time defaults to now.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

interface Props {
  open: boolean;
  onClose: () => void;
  /** At least one must be set. The dialog won't open without it (defensive). */
  propertyId?: string;
  contactId?: string;
  dealId?: string;
  /** Friendly label so the broker sees what they're logging against. */
  contextLabel?: string;
  /** Optional default type — e.g. set "tour" when opened from a tour shortcut. */
  defaultType?: ActivityType;
}

type ActivityType = "call" | "meeting" | "tour" | "note" | "text" | "email" | "mail" | "other";

const TYPE_OPTIONS: { value: ActivityType; label: string; needsDuration: boolean }[] = [
  { value: "call",    label: "Call",    needsDuration: true },
  { value: "meeting", label: "Meeting", needsDuration: true },
  { value: "tour",    label: "Tour",    needsDuration: true },
  { value: "note",    label: "Note",    needsDuration: false },
  { value: "text",    label: "Text",    needsDuration: false },
  { value: "email",   label: "Email",   needsDuration: false },
  { value: "mail",    label: "Mail",    needsDuration: false },
  { value: "other",   label: "Other",   needsDuration: false },
];

/** Format Date → input[type=datetime-local] friendly string in local TZ. */
function localNowString(): string {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function LogActivityDialog({
  open,
  onClose,
  propertyId,
  contactId,
  dealId,
  contextLabel,
  defaultType = "call",
}: Props) {
  const router = useRouter();

  const [activityType, setActivityType] = useState<ActivityType>(defaultType);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [occurredAt, setOccurredAt] = useState<string>(localNowString());
  const [durationMinutes, setDurationMinutes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form fields each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setActivityType(defaultType);
    setSubject("");
    setBody("");
    setOccurredAt(localNowString());
    setDurationMinutes("");
    setError(null);
  }, [open, defaultType]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // SSR-safe portal target — only valid on the client.
  if (typeof document === "undefined") return null;

  const typeMeta = TYPE_OPTIONS.find((t) => t.value === activityType) ?? TYPE_OPTIONS[0];
  const showDuration = typeMeta.needsDuration;

  async function submit() {
    setError(null);
    if (!subject.trim() && !body.trim()) {
      setError("Add a subject or some notes.");
      return;
    }
    setBusy(true);
    try {
      // Convert local datetime-local back to an ISO timestamp.
      const isoOccurred = occurredAt
        ? new Date(occurredAt).toISOString()
        : new Date().toISOString();
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activity_type: activityType,
          subject: subject.trim() || null,
          body: body.trim() || null,
          occurred_at: isoOccurred,
          duration_minutes: showDuration && durationMinutes ? Number(durationMinutes) : null,
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

  // Portal to document.body so the dialog escapes any ancestor that
  // creates a containing block (e.g. PropertyHeader's backdrop-blur-md).
  // Without this, fixed inset-0 anchors inside the blurred ancestor instead
  // of the viewport, and the dialog appears tucked into the header area.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-2 mx-2 lg:my-12 w-full max-w-lg bg-steward-base border border-white/[0.08] rounded shadow-panel-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-coral-400">Log activity</div>
            <h2 className="mt-0.5 font-heading text-base font-semibold text-cream truncate">
              {contextLabel ? `Against ${contextLabel}` : "New activity"}
            </h2>
          </div>
          <button onClick={onClose} className="text-cream-subtle hover:text-cream font-mono text-lg leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Type chips — pill row, click to switch. Most common (call) is
              the default; meeting/tour/note follow. */}
          <Field label="Type">
            <div className="flex flex-wrap gap-1">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setActivityType(t.value)}
                  className={`px-2.5 py-1 rounded font-heading text-[10px] uppercase tracking-eyebrow font-semibold transition-colors ${
                    activityType === t.value
                      ? "bg-coral-400/[0.15] text-coral-200 ring-1 ring-inset ring-coral-400/30"
                      : "bg-white/[0.04] text-cream-dim hover:bg-white/[0.08] hover:text-cream"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Subject" hint="Short headline — 'Followup re: 850 Lakeshore', 'Tour with Smith Group'.">
            <input
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={typeMeta.value === "tour" ? "Tour with …" : typeMeta.value === "call" ? "Call with …" : "Brief headline"}
              className={inputCls}
            />
          </Field>

          <Field label="Notes" hint="What was said, what's next, anything you want remembered.">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder="Free-form."
              className={`${inputCls} resize-y`}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="When">
              <input
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className={inputCls}
              />
            </Field>
            {showDuration && (
              <Field label="Duration (min)">
                <input
                  type="number"
                  min={0}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  placeholder="30"
                  className={inputCls}
                />
              </Field>
            )}
          </div>

          {error && (
            <div className="rounded border border-red-400/30 bg-red-500/[0.08] px-3 py-2 font-body text-[11px] text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/[0.04]">
            <span className="font-mono text-[10px] text-cream-subtle">
              {/* Help text — explain the side-effect when a contact is attached
                  so the broker isn't surprised that "warmth" updates. */}
              {contactId && ["call", "meeting", "tour"].includes(activityType)
                ? "Will also bump this contact's last-conversation date."
                : ""}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Logging…" : "Log activity"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

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
