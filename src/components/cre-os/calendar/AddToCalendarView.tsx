"use client";

import { useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";

interface DraftEvent {
  title: string;
  date: string;
  start: string | null;
  end: string | null;
  location: string | null;
  details: string | null;
}

interface Row extends DraftEvent {
  key: string;
  on: boolean;
  result?: { status: "added" | "duplicate" | "error"; link?: string | null; error?: string };
}

const fieldCls =
  "w-full px-3 py-2 bg-white/[0.02] border border-white/[0.10] focus:border-coral-400/60 focus:outline-none font-body text-base lg:text-[13px] text-cream placeholder:text-cream-subtle";

function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "a" : "p"}`;
}

/** Read a File as base64 (no data: prefix). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * AddToCalendarView — paste a schedule or attach a PDF/photo, review what
 * was read, add the checked events to Google Calendar. Nothing reaches the
 * calendar until "Add"; nobody is invited; anything already there at the
 * same time with the same title is skipped.
 */
export function AddToCalendarView({ canWrite, account }: { canWrite: boolean; account: string | null }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  async function read() {
    setError(null);
    setNote(null);
    setRows(null);
    if (!text.trim() && !file) {
      setError("Paste something or attach a file.");
      return;
    }
    if (file && file.size > 4 * 1024 * 1024) {
      setError("That file is over 4 MB. Try a screenshot instead.");
      return;
    }
    setReading(true);
    try {
      const payload: Record<string, unknown> = { text };
      if (file) payload.file = { name: file.name, type: file.type, data: await toBase64(file) };
      const r = await fetch("/api/calendar/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const evs = (j.events ?? []) as DraftEvent[];
      if (!evs.length) throw new Error("Didn't find any events in that.");
      setRows(evs.map((e, i) => ({ ...e, key: `${i}-${e.date}-${e.start}`, on: true })));
      setNote(j.note ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  }

  async function add() {
    if (!rows) return;
    const picked = rows.filter((r) => r.on && !r.result);
    if (!picked.length) return;
    setAdding(true);
    setError(null);
    try {
      const r = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: picked.map(({ title, date, start, end, location, details }) => ({ title, date, start, end, location, details })),
        }),
      });
      const j = await r.json();
      if (!r.ok && !j.results) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.error) throw new Error(j.error);
      const results = (j.results ?? []) as Array<{ status: "added" | "duplicate" | "error"; link?: string | null; error?: string }>;
      setRows((cur) => {
        if (!cur) return cur;
        let i = 0;
        return cur.map((row) => (row.on && !row.result ? { ...row, result: results[i++] } : row));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((cur) => cur?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null);
  }

  const pending = rows?.filter((r) => r.on && !r.result).length ?? 0;
  const added = rows?.filter((r) => r.result?.status === "added").length ?? 0;
  const dupes = rows?.filter((r) => r.result?.status === "duplicate").length ?? 0;

  // Group rows by day for display.
  const days = rows ? Array.from(new Set(rows.map((r) => r.date))).sort() : [];

  return (
    <AppShell>
      <div className="max-w-2xl space-y-5">
        <header>
          <div className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream-muted">
            {account ?? "Google Calendar"}
          </div>
          <h1 className="mt-1 font-display text-[30px] font-extrabold text-cream leading-none">Add to calendar</h1>
          <p className="mt-2 font-body text-[14px] text-cream-muted">
            Paste a schedule, an email or a plan — or attach a PDF or photo. Check what was read, then add it.
            Nobody is invited, and anything already on your calendar is skipped.
          </p>
        </header>

        {!canWrite && (
          <div className="border-2 border-coral-400 bg-steward-surface px-4 py-3">
            <p className="font-body text-[14px] text-cream">
              {account ? "Your calendar connection is read-only." : "Your personal Google account isn't connected."} Reconnect
              once and allow the CRM to add events.
            </p>
            <a
              href="/api/auth/google/connect?account=personal"
              className="mt-2 inline-block px-3.5 py-2 bg-copper-600 hover:bg-copper-700 font-heading text-[12px] font-semibold text-white"
            >
              Reconnect Google Calendar
            </a>
          </div>
        )}

        <section className="border border-white/[0.08] bg-steward-surface px-4 py-4 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            disabled={reading}
            placeholder={'e.g. "Lunch with Ravi Thursday 12:30 at Teibel\'s" — or paste an agenda. You can add "just the sessions and breaks".'}
            className={`${fieldCls} resize-y`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="px-3 py-2 border border-white/[0.10] bg-white/[0.02] hover:bg-white/[0.05] font-heading text-[12px] font-semibold text-cream cursor-pointer">
              {file ? "Change file" : "Attach PDF or photo"}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {file && (
              <span className="font-mono text-[11px] text-cream-muted truncate max-w-[60%]">
                {file.name}{" "}
                <button onClick={() => setFile(null)} className="underline ml-1">remove</button>
              </span>
            )}
          </div>
          <button
            onClick={read}
            disabled={reading}
            className="w-full sm:w-auto px-4 py-2.5 bg-copper-600 hover:bg-copper-700 font-heading text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {reading ? "Reading…" : "Read it"}
          </button>
          {error && <p className="font-body text-[13px] text-red-300">{error}</p>}
        </section>

        {rows && (
          <section className="space-y-4">
            {note && <p className="font-body text-[13px] text-amber-300">Heads up: {note}</p>}
            {days.map((day) => (
              <div key={day}>
                <div className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream-muted mb-1.5">{fmtDay(day)}</div>
                <div className="border border-white/[0.08] bg-steward-surface divide-y divide-white/[0.06]">
                  {rows.filter((r) => r.date === day).map((r) => (
                    <div key={r.key} className="flex items-start gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={r.on}
                        disabled={!!r.result || adding}
                        onChange={(e) => update(r.key, { on: e.target.checked })}
                        className="mt-1.5 h-4 w-4 shrink-0 accent-[#B4552F]"
                      />
                      <div className="min-w-0 flex-1">
                        <input
                          value={r.title}
                          disabled={!!r.result || adding}
                          onChange={(e) => update(r.key, { title: e.target.value })}
                          className="w-full bg-transparent font-heading text-[14px] font-semibold text-cream focus:outline-none focus:bg-white/[0.03]"
                        />
                        <div className="font-mono text-[11px] text-cream-muted">
                          {r.start ? `${fmtTime(r.start)}–${fmtTime(r.end)}` : "All day"}
                          {r.location ? ` · ${r.location}` : ""}
                        </div>
                        {r.details && <div className="font-body text-[12px] text-cream-dim">{r.details}</div>}
                      </div>
                      {r.result && (
                        <span
                          className={`shrink-0 font-mono text-[10px] uppercase tracking-eyebrow ${
                            r.result.status === "added" ? "text-teal-400" : r.result.status === "duplicate" ? "text-cream-muted" : "text-red-300"
                          }`}
                          title={r.result.error}
                        >
                          {r.result.status === "added" ? "Added" : r.result.status === "duplicate" ? "Already there" : "Failed"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {(added > 0 || dupes > 0) && (
              <p className="font-body text-[14px] text-cream">
                {added} added{dupes ? ` · ${dupes} already on your calendar` : ""}.
              </p>
            )}
            {pending > 0 && (
              <button
                onClick={add}
                disabled={adding || !canWrite}
                className="w-full sm:w-auto px-4 py-2.5 bg-copper-600 hover:bg-copper-700 font-heading text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {adding ? "Adding…" : `Add ${pending} to calendar`}
              </button>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
