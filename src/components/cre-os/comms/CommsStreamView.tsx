"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { ThreadPanel } from "./ThreadPanel";
import { useIsDesktop, isTypingTarget } from "@/lib/cre-os/use-is-desktop";
import type { StreamData, StreamRow } from "@/lib/cre-os/comms-stream-queries";

/**
 * CommsStreamView — the north-star Communications surface.
 *
 * ONE ROW PER PERSON (messages-app model, 7/29 redesign at John's request):
 * a conversation row shows the latest touch with that person and simply
 * updates in place when either side speaks — John's own reply must never
 * spawn a new stream row; it updates the row's preview ("You: …") and
 * clears the red Unanswered state.
 *
 * Phone: the list; tapping opens the thread as a bottom sheet.
 * Desktop (lg+): master–detail — list left, conversation inline right,
 * ↓/↑ (J/K) walk the list, Enter opens, Esc closes. The full touch-by-
 * touch log lives in the Outreach tracker, not here.
 */

const CHANNEL_META: Record<string, { label: string; word: string }> = {
  email: { label: "Email", word: "email" },
  sms: { label: "Text", word: "text" },
  phone: { label: "Call", word: "call" },
  website: { label: "Web", word: "web form" },
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

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  return (parts[0][0] + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export function CommsStreamView({ data }: { data: StreamData }) {
  const desktop = useIsDesktop();
  const [channel, setChannel] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  // The QUEUE is the default view (John's call, 7/29): land on the people
  // waiting on you; replying makes them leave this screen. "All" is the
  // browsable archive, one tap away.
  const [unansweredOnly, setUnansweredOnly] = useState(true);
  const [peopleOnly, setPeopleOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [showCleared, setShowCleared] = useState(false);
  const [clearedIds, setClearedIds] = useState<Record<string, boolean>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);

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

  const openable = (c: Conversation) => !!(c.leadId || c.contactId);
  const openConv = filtered.find((c) => c.key === openKey) ?? null;

  // Desktop: first conversation open on landing (once).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!desktop || openKey || autoOpened.current) return;
    const first = filtered.find(openable);
    if (first) {
      autoOpened.current = true;
      setOpenKey(first.key);
    }
  }, [desktop, openKey, filtered]);

  // Desktop keyboard: ↓/↑ or J/K, Enter, Esc. Ignored while typing.
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const list = filtered.filter(openable);
      if (list.length === 0) return;
      const idx = openKey ? list.findIndex((c) => c.key === openKey) : -1;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setOpenKey(list[Math.min(idx + 1, list.length - 1)].key);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setOpenKey(list[Math.max(idx - 1, 0)].key);
      } else if (e.key === "Escape") {
        setOpenKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, filtered, openKey]);

  const chip = (active: boolean) =>
    `px-3 py-1.5 font-heading text-[11px] font-bold uppercase tracking-eyebrow transition-colors border-2 ${
      active
        ? "bg-cream text-steward-base border-cream"
        : "border-white/[0.10] text-cream-dim hover:border-cream"
    }`;

  const thread = openConv ? (
    <ThreadPanel
      key={openConv.key}
      variant={desktop ? "inline" : "overlay"}
      leadId={openConv.leadId}
      contactId={openConv.contactId}
      initialChannel={openConv.latest.channel}
      onClose={() => setOpenKey(null)}
    />
  ) : null;

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream-muted">Communications</div>
            <h1 className="mt-1 font-display text-[30px] font-extrabold text-cream leading-none">One stream</h1>
            <p className="mt-2 font-body text-[14px] text-cream-muted">
              {unansweredOnly
                ? "People waiting on a reply. Answer someone and they leave this list."
                : "Every conversation, newest activity first. Copper means they're waiting on you."}
            </p>
          </div>
          {desktop && (
            <div className="font-mono text-[11px] text-cream-subtle">↓ ↑ move · Enter open · Esc close</div>
          )}
        </header>

        <div className="flex items-center gap-2 flex-wrap">
          <button className={chip(!channel && !unansweredOnly)} onClick={() => { setChannel(null); setUnansweredOnly(false); }}>
            All
          </button>
          <button className={chip(unansweredOnly)} onClick={() => setUnansweredOnly((v) => !v)}>
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
            className="ml-auto bg-steward-surface border-2 border-white/[0.10] px-2 py-1.5 font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream-dim"
          >
            <option value="">Property: any</option>
            {data.properties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] xl:grid-cols-[520px_minmax(0,1fr)] lg:gap-6 lg:items-start">
          <div className="min-w-0 space-y-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people, subjects, messages, properties…"
              className="w-full border-2 border-white/[0.10] bg-steward-surface px-3 py-2.5 font-body text-[14px] text-cream placeholder:text-cream-subtle focus:border-coral-400 focus:outline-none"
            />

            {groups.length === 0 && (
              <p className="font-body text-[15px] text-cream-muted py-8">
                {unansweredOnly && !search && !channel && !propertyId
                  ? "All caught up — nobody is waiting on you. Tap All to browse past conversations."
                  : "No conversations match. Clear a filter or include automated sends."}
              </p>
            )}

            {groups.map((g) => (
              <section key={g.day}>
                <div className="flex items-baseline justify-between border-b-2 border-cream pb-1.5">
                  <h2 className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream">{g.day}</h2>
                  <span className="font-mono text-[12px] font-semibold text-cream-subtle">{g.items.length}</span>
                </div>
                <div>
                  {g.items.map((c) => {
                    const meta = CHANNEL_META[c.latest.channel] ?? { label: c.latest.channel, word: c.latest.channel };
                    const can = openable(c);
                    const selected = openKey === c.key;
                    const youSpokeLast = c.latest.direction === "outbound";
                    return (
                      <div
                        key={c.key}
                        className={`flex items-start gap-3 border-b border-white/[0.06] px-3 py-3 border-l-[3px] ${
                          selected
                            ? "bg-copper-100 border-l-coral-400"
                            : c.unanswered
                              ? "bg-steward-surface border-l-coral-400"
                              : "bg-steward-surface border-l-transparent"
                        }`}
                        aria-current={selected ? "true" : undefined}
                      >
                        <button
                          type="button"
                          disabled={!can}
                          onClick={() => can && setOpenKey(c.key)}
                          className="min-w-0 flex-1 flex items-start gap-3 text-left disabled:cursor-default"
                        >
                          <span className="w-9 h-9 shrink-0 rounded-full bg-ink-200 text-ink-900 flex items-center justify-center font-heading text-[12px] font-bold">
                            {initials(c.who)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="font-heading text-[15px] font-semibold text-cream truncate">
                                {c.who}
                                {c.latest.automated && (
                                  <span className="ml-2 bg-ink-200 px-1.5 py-px font-heading text-[9px] font-bold uppercase tracking-eyebrow text-ink-700 align-middle">
                                    {c.latest.touchKind ?? "auto"}
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-[11px] text-cream-subtle shrink-0">{c.latest.when}</span>
                            </span>
                            <span className="mt-0.5 block font-body text-[13px] text-cream-muted truncate">
                              {youSpokeLast && <span className="text-ink-700 font-semibold">You: </span>}
                              {c.latest.subject ? <span className="text-cream">{c.latest.subject}</span> : null}
                              {c.latest.subject && c.latest.preview ? " — " : null}
                              {c.latest.preview}
                            </span>
                            <span className="mt-1 flex items-center gap-2 font-body text-[12px] text-cream-subtle">
                              {c.property && (
                                <span className="bg-ink-200 px-1.5 py-px font-heading text-[10px] font-bold uppercase tracking-eyebrow text-ink-700">
                                  {c.property.name}
                                </span>
                              )}
                              <span>{meta.word}</span>
                              {c.touchCount > 1 && <span>· {c.touchCount} touches</span>}
                              {c.unanswered && <span className="font-heading text-[10px] font-bold uppercase tracking-eyebrow text-coral-400">· waiting</span>}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleCleared(c.latest.id, !showCleared)}
                          className="shrink-0 px-2 py-1 border border-white/[0.10] font-heading text-[10px] font-bold uppercase tracking-eyebrow text-cream-subtle hover:border-cream hover:text-cream transition-colors"
                          title={showCleared ? "Restore to the stream" : "Clear from the stream (kept in history — reversible)"}
                        >
                          {showCleared ? "Restore" : "Clear"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {desktop && (
            <div className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100dvh-14rem)]">
              {thread ?? (
                <div className="h-full flex items-center justify-center border-l-2 border-cream bg-steward-surface">
                  <p className="font-body text-[15px] text-cream-muted">Pick a conversation on the left.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!desktop && thread}
    </AppShell>
  );
}
