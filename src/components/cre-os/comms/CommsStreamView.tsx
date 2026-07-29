"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { ThreadPanel } from "./ThreadPanel";
import type { StreamData, StreamRow } from "@/lib/cre-os/comms-stream-queries";

/**
 * CommsStreamView — the north-star Communications surface.
 *
 * ONE ROW PER PERSON (messages-app model, 7/29 redesign at John's request):
 * a conversation row shows the latest touch with that person and simply
 * updates in place when either side speaks — John's own reply must never
 * spawn a new stream row; it updates the row's preview ("You: …") and
 * clears the red Unanswered state. Tap → ThreadPanel with the full
 * back-and-forth + reply bar. The full touch-by-touch log lives in the
 * Outreach tracker, not here.
 */

const CHANNEL_META: Record<string, { label: string; glyph: string }> = {
  email: { label: "Email", glyph: "✉" },
  sms: { label: "Text", glyph: "▣" },
  phone: { label: "Call", glyph: "☎" },
  website: { label: "Web", glyph: "◆" },
};

interface Conversation {
  key: string;
  who: string;
  latest: StreamRow;
  touchCount: number;
  leadId: string | null;
  contactId: string | null;
  property: { id: string; name: string } | null;
  channels: Set<string>;
  unanswered: boolean;
}

export function CommsStreamView({ data }: { data: StreamData }) {
  const [channel, setChannel] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [unansweredOnly, setUnansweredOnly] = useState(false);
  const [peopleOnly, setPeopleOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [showCleared, setShowCleared] = useState(false);
  const [clearedIds, setClearedIds] = useState<Record<string, boolean>>({});
  const [openThread, setOpenThread] = useState<{ leadId: string; channel: string } | null>(null);

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

  // Group the touch log into one conversation per person. data.rows is
  // newest-first, so first sighting of a party IS its latest touch — Map
  // insertion order keeps conversations sorted by recency for free.
  const conversations = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const r of data.rows) {
      const key = r.contactId ? `c:${r.contactId}` : `w:${r.who.toLowerCase()}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          who: r.who,
          latest: r,
          touchCount: 1,
          leadId: r.leadId,
          contactId: r.contactId,
          property: r.property,
          channels: new Set([r.channel]),
          unanswered: r.unanswered,
        });
      } else {
        existing.touchCount += 1;
        existing.channels.add(r.channel);
        if (!existing.leadId && r.leadId) existing.leadId = r.leadId;
        if (!existing.property && r.property) existing.property = r.property;
        if (r.unanswered) existing.unanswered = true;
      }
    }
    return Array.from(map.values());
  }, [data.rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const isCleared = clearedIds[c.latest.id] ?? c.latest.cleared;
      if (showCleared !== isCleared) return false;
      if (channel && !c.channels.has(channel)) return false;
      if (propertyId && c.property?.id !== propertyId) return false;
      if (unansweredOnly && !c.unanswered) return false;
      if (peopleOnly && c.latest.automated) return false;
      if (q) {
        const hay = `${c.who} ${c.latest.subject ?? ""} ${c.latest.preview ?? ""} ${c.property?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [conversations, channel, propertyId, unansweredOnly, peopleOnly, search, showCleared, clearedIds]);

  const groups = useMemo(() => {
    const g: Array<{ day: string; items: Conversation[] }> = [];
    for (const c of filtered) {
      const last = g[g.length - 1];
      if (last && last.day === c.latest.dayKey) last.items.push(c);
      else g.push({ day: c.latest.dayKey, items: [c] });
    }
    return g;
  }, [filtered]);

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
          <Eyebrow>Communications · every conversation</Eyebrow>
          <h1 className="font-heading text-[26px] font-bold text-cream mt-1">One stream</h1>
          <p className="font-body text-[13px] text-cream-dim mt-1">
            One row per person, newest activity first. Red means they&apos;re waiting on you — reply and it clears.
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
          <button className={chip(showCleared)} onClick={() => setShowCleared((v) => !v)} title="Cleared conversations are hidden, never deleted">
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
            No conversations match. Clear a filter or include automated sends.
          </p>
        )}

        {groups.map((g) => (
          <section key={g.day}>
            <Eyebrow>{g.day}</Eyebrow>
            <div className="mt-2 space-y-2">
              {g.items.map((c) => {
                const meta = CHANNEL_META[c.latest.channel] ?? { label: c.latest.channel, glyph: "•" };
                const open = c.leadId
                  ? () => setOpenThread({ leadId: c.leadId!, channel: c.latest.channel })
                  : c.contactId
                    ? () => { window.location.href = `/cre-os/relationships/${c.contactId}`; }
                    : null;
                const youSpokeLast = c.latest.direction === "outbound";
                return (
                  <div
                    key={c.key}
                    {...(open
                      ? {
                          onClick: open,
                          role: "button",
                          tabIndex: 0,
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === "Enter") open();
                          },
                        }
                      : {})}
                    className={`block p-3 rounded border transition-colors ${open ? "cursor-pointer" : ""} ${
                      c.unanswered
                        ? "border-coral-400/40 bg-coral-400/[0.04] hover:bg-coral-400/[0.07]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-heading text-[13px] font-semibold text-cream truncate">
                        {c.who}
                        {c.latest.automated && (
                          <span className="ml-2 px-1.5 py-0.5 rounded bg-white/[0.06] font-mono text-[9px] uppercase text-cream-subtle align-middle">
                            {c.latest.touchKind ?? "auto"}
                          </span>
                        )}
                        {c.touchCount > 1 && (
                          <span className="ml-2 font-mono text-[10px] text-cream-subtle">· {c.touchCount} touches</span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-cream-subtle shrink-0">{c.latest.when}</span>
                    </div>
                    <p className="mt-1 font-body text-[12px] text-cream-dim leading-snug truncate">
                      <span className="font-mono text-[10px] text-cream-subtle mr-1.5" aria-hidden="true">{meta.glyph}</span>
                      {youSpokeLast && <span className="text-teal-300">You: </span>}
                      {c.latest.subject ? <span className="text-cream">{c.latest.subject}</span> : null}
                      {c.latest.subject && c.latest.preview ? " — " : null}
                      {c.latest.preview}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      {c.property && (
                        <span className="px-2 py-0.5 rounded-full bg-teal-400/[0.08] border border-teal-400/25 font-mono text-[10px] text-teal-300">
                          {c.property.name}
                        </span>
                      )}
                      {c.unanswered && (
                        <span className="px-2 py-0.5 rounded-full bg-coral-400/[0.10] border border-coral-400/40 font-mono text-[10px] text-coral-300">
                          Unanswered
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleCleared(c.latest.id, !showCleared);
                        }}
                        className="ml-auto px-2 py-0.5 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream transition-colors"
                        title={showCleared ? "Restore to the stream" : "Clear from the stream (kept in history — reversible)"}
                      >
                        {showCleared ? "Restore" : "Clear"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {openThread && (
        <ThreadPanel
          leadId={openThread.leadId}
          initialChannel={openThread.channel}
          onClose={() => setOpenThread(null)}
        />
      )}
    </AppShell>
  );
}
