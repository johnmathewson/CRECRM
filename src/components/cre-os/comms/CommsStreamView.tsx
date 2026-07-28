"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { StreamData, StreamRow } from "@/lib/cre-os/comms-stream-queries";

/**
 * CommsStreamView — the north-star Communications surface.
 *
 * One chronological stream of every touch (email / text / call), newest
 * first, grouped by day. Filters are client-side chips: channel, property,
 * Unanswered, and "people only" (hides automated sends). Rows link into the
 * lead workspace when one exists.
 *
 * READ-ONLY over the communications log — replies happen in the lead
 * workspace (SMS composer + email send live there).
 */

const CHANNEL_META: Record<string, { label: string; glyph: string }> = {
  email: { label: "Email", glyph: "✉" },
  sms: { label: "Text", glyph: "▣" },
  phone: { label: "Call", glyph: "☎" },
  website: { label: "Web", glyph: "◆" },
};

export function CommsStreamView({ data }: { data: StreamData }) {
  const [channel, setChannel] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [peopleOnly, setPeopleOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [showCleared, setShowCleared] = useState(false);
  const [clearedIds, setClearedIds] = useState<Record<string, boolean>>({});

  async function toggleCleared(id: string, cleared: boolean) {
    setClearedIds((m) => ({ ...m, [id]: cleared }));
    try {
      await fetch(`/api/communications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleared }),
      });
    } catch {
      setClearedIds((m) => ({ ...m, [id]: !cleared }));
    }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      const isCleared = clearedIds[r.id] ?? r.cleared;
      if (showCleared !== isCleared) return false;
      if (channel && r.channel !== channel) return false;
      if (propertyId && r.property?.id !== propertyId) return false;
      if (unansweredOnly && !r.unanswered) return false;
      if (peopleOnly && r.automated) return false;
      if (q) {
        const hay = `${r.who} ${r.subject ?? ""} ${r.preview ?? ""} ${r.property?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.rows, channel, propertyId, unansweredOnly, peopleOnly, search, showCleared, clearedIds]);

  const groups = useMemo(() => {
    const g: Array<{ day: string; items: StreamRow[] }> = [];
    for (const r of rows) {
      const last = g[g.length - 1];
      if (last && last.day === r.dayKey) last.items.push(r);
      else g.push({ day: r.dayKey, items: [r] });
    }
    return g;
  }, [rows]);

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full font-heading text-[11px] uppercase tracking-eyebrow transition-colors border ${
      active
        ? "bg-coral-400 text-steward-base border-coral-400"
        : "border-white/10 bg-white/[0.03] text-cream-dim hover:bg-white/[0.06]"
    }`;

  return (
    <AppShell>
      <div className="space-y-4 pb-10">
        <div>
          <Eyebrow>Communications · every touch</Eyebrow>
          <h1 className="font-heading text-[26px] font-bold text-cream mt-1">One stream</h1>
          <p className="font-body text-[13px] text-cream-dim mt-1">
            Every email, text, and call — newest first. Filter fast; red means a person is waiting on you.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className={chip(!channel && !unansweredOnly)} onClick={() => { setChannel(null); setUnansweredOnly(false); }}>
            All
          </button>
          <button
            className={`${chip(unansweredOnly)} ${data.unansweredCount > 0 && !unansweredOnly ? "border-coral-400/50 text-coral-300" : ""}`}
            onClick={() => setUnansweredOnly((v) => !v)}
          >
            Unanswered · {data.unansweredCount}
          </button>
          {Object.entries(CHANNEL_META).map(([key, m]) => (
            <button key={key} className={chip(channel === key)} onClick={() => setChannel(channel === key ? null : key)}>
              {m.label}
            </button>
          ))}
          <button className={chip(!peopleOnly)} onClick={() => setPeopleOnly((v) => !v)} title="Include automated sends (AI follow-ups, auto-acks, briefs)">
            {peopleOnly ? "People only" : "Incl. automated"}
          </button>
          <button className={chip(showCleared)} onClick={() => setShowCleared((v) => !v)} title="Cleared touches are hidden, never deleted">
            {showCleared ? "Viewing cleared" : "Cleared"}
          </button>
          <select
            value={propertyId ?? ""}
            onChange={(e) => setPropertyId(e.target.value || null)}
            className="ml-auto bg-white/[0.03] border border-white/10 rounded px-2 py-1.5 font-heading text-[11px] uppercase tracking-eyebrow text-cream-dim"
          >
            <option value="">Property: any</option>
            {data.properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search people, subjects, messages, properties…"
          className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-2.5 font-body text-[13px] text-cream placeholder:text-cream-subtle focus:border-teal-400/40 focus:outline-none"
        />

        {groups.length === 0 && (
          <p className="font-body text-[13px] text-cream-dim py-8 text-center">
            No touches match. Clear a filter or include automated sends.
          </p>
        )}

        {groups.map((g) => (
          <section key={g.day}>
            <Eyebrow>{g.day}</Eyebrow>
            <div className="mt-2 space-y-2">
              {g.items.map((r) => {
                const meta = CHANNEL_META[r.channel] ?? { label: r.channel, glyph: "•" };
                const href = r.leadId ? `/cre-os/inbox/${r.leadId}` : undefined;
                const Row = href ? "a" : "div";
                return (
                  <Row
                    key={r.id}
                    {...(href ? { href } : {})}
                    className={`block p-3 rounded border transition-colors ${
                      r.unanswered
                        ? "border-coral-400/40 bg-coral-400/[0.04] hover:bg-coral-400/[0.07]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-heading text-[12px] font-semibold text-cream truncate">
                        <span className="font-mono text-[11px] text-cream-subtle mr-2" aria-hidden="true">{meta.glyph} {meta.label}</span>
                        {r.direction === "outbound" ? (
                          <>You <span className="text-cream-subtle">→</span> {r.who}</>
                        ) : (
                          <>{r.who} <span className="text-cream-subtle">→</span> you</>
                        )}
                        {r.automated && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-white/[0.06] font-mono text-[9px] uppercase text-cream-subtle align-middle">
                            {r.touchKind ?? "auto"}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-cream-subtle shrink-0">{r.when}</span>
                    </div>
                    {(r.subject || r.preview) && (
                      <p className="mt-1 font-body text-[12px] text-cream-dim leading-snug truncate">
                        {r.subject ? <span className="text-cream">{r.subject}</span> : null}
                        {r.subject && r.preview ? " — " : null}
                        {r.preview}
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2">
                      {r.property && (
                        <span className="px-2 py-0.5 rounded-full bg-teal-400/[0.08] border border-teal-400/25 font-mono text-[10px] text-teal-300">
                          {r.property.name}
                        </span>
                      )}
                      {r.unanswered && (
                        <span className="px-2 py-0.5 rounded-full bg-coral-400/[0.10] border border-coral-400/40 font-mono text-[10px] text-coral-300">
                          Unanswered
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleCleared(r.id, !showCleared);
                        }}
                        className="ml-auto px-2 py-0.5 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream transition-colors"
                        title={showCleared ? "Restore to the stream" : "Clear from the stream (kept in history — reversible)"}
                      >
                        {showCleared ? "Restore" : "Clear"}
                      </button>
                    </div>
                  </Row>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
