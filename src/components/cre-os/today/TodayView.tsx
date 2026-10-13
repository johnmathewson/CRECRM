"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { ThreadPanel } from "@/components/cre-os/comms/ThreadPanel";
import { useIsDesktop, isTypingTarget } from "@/lib/cre-os/use-is-desktop";

/**
 * TodayView — the kitchen. No dashboard, no rails, no hot/warm badges: a
 * list of decisions, waiting-first, with the reply one tap away.
 *
 * Phone: the queue; tapping a row opens the thread as a bottom sheet.
 * Desktop (lg+): master–detail. Queue on the left, the open conversation
 * inline on the right (first waiting person pre-selected), so the morning
 * is read → edit → send → next without a single overlay.
 *
 * Every row can also be cleared out: Clear (message marked read, nothing
 * deleted), Spam (lead → spam), Archive (lead → archived).
 *
 * Brand: Bone canvas, White rows, Archivo, 2px Ink section rules, one
 * Copper action per row. Zero radius.
 */

export interface TodayRow {
  /** communications.id for a waiting row, leads.id for a queued lead */
  id: string;
  kind: "comm" | "lead";
  leadId: string | null;
  contactId: string | null;
  who: string;
  property: string | null;
  what: string;
  channel: string;
  when: string;
  action: "Reply" | "Send draft";
}

const CHANNEL_WORD: Record<string, string> = {
  email: "email",
  sms: "text",
  phone: "call",
  website: "web form",
  crexi: "CREXi",
};

function initials(name: string): string {
  const parts = name.replace(/[^a-zA-Z ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  return (parts[0][0] + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

type Dismiss = "clear" | "spam" | "archive";

export function TodayView({
  waiting: waitingInitial,
  next: nextInitial,
  brief,
}: {
  waiting: TodayRow[];
  next: TodayRow[];
  brief: { lede: string; date: string } | null;
}) {
  const router = useRouter();
  const desktop = useIsDesktop();
  const [waiting, setWaiting] = useState(waitingInitial);
  const [next, setNext] = useState(nextInitial);
  const [open, setOpen] = useState<TodayRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Fresh server data (after a send / refresh) replaces the lists.
  useEffect(() => { setWaiting(waitingInitial); }, [waitingInitial]);
  useEffect(() => { setNext(nextInitial); }, [nextInitial]);

  // Desktop: the first person waiting is already open when the page lands
  // (once — closing the column afterwards leaves it closed).
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!desktop || open || autoOpened.current) return;
    const first = waiting[0] ?? next[0] ?? null;
    if (first) {
      autoOpened.current = true;
      setOpen(first);
    }
  }, [desktop, open, waiting, next]);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // Desktop keyboard: ↓/↑ or J/K walk the queue, Enter opens, Esc closes.
  // Ignored while typing (the reply box, the ⌘K search).
  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const all = [...waiting, ...next];
      if (all.length === 0) return;
      const idx = open ? all.findIndex((r) => r.id === open.id) : -1;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setOpen(all[Math.min(idx + 1, all.length - 1)]);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setOpen(all[Math.max(idx - 1, 0)]);
      } else if (e.key === "Escape") {
        setOpen(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, waiting, next, open]);

  const openRow = (r: TodayRow) => {
    if (!r.leadId && !r.contactId) return;
    setOpen(r);
  };

  /** After the open conversation changes (send, dismiss), move to the next
   *  person on desktop instead of leaving an empty column. */
  const advanceFrom = (row: TodayRow) => {
    const all = [...waiting, ...next].filter((r) => r.id !== row.id);
    setOpen(desktop ? (all[0] ?? null) : null);
  };

  async function dismiss(row: TodayRow, how: Dismiss) {
    // Optimistic: the row leaves the list now; the server catches up.
    setWaiting((w) => w.filter((r) => r.id !== row.id));
    setNext((n) => n.filter((r) => r.id !== row.id));
    if (open?.id === row.id) advanceFrom(row);
    try {
      if (row.kind === "comm") {
        const res = await fetch(`/api/communications/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cleared: true }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Could not clear");
      }
      if (how !== "clear" && row.leadId) {
        const res = await fetch(`/api/leads/${row.leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: how === "spam" ? "spam" : "archived", user_action: "archive" }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Could not update lead");
      }
      setNotice(how === "clear" ? `Cleared ${row.who}` : how === "spam" ? `${row.who} marked spam` : `${row.who} archived`);
      setTimeout(() => setNotice(null), 2500);
      router.refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "That didn't save — refresh and try again");
      router.refresh();
    }
  }

  const queue = (
    <div className="space-y-8">
      {notice && (
        <div className="bg-cream px-3 py-2 font-body text-[13px] text-steward-base" role="status">
          {notice}
        </div>
      )}

      <Section label="Waiting on you" count={waiting.length}>
        {waiting.length === 0 ? (
          <Empty>Nobody is waiting on you.</Empty>
        ) : (
          waiting.map((r) => (
            <Row key={r.id} row={r} primary selected={open?.id === r.id} onOpen={openRow} onDismiss={dismiss} />
          ))
        )}
      </Section>

      <Section label="Next up" count={next.length}>
        {next.length === 0 ? (
          <Empty>Nothing queued. The pipeline and people pages have the rest.</Empty>
        ) : (
          next.map((r) => (
            <Row key={r.id} row={r} selected={open?.id === r.id} onOpen={openRow} onDismiss={dismiss} />
          ))
        )}
      </Section>
    </div>
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream-muted">{today}</div>
            <h1 className="mt-1 font-display text-[30px] font-extrabold text-cream leading-none">Today</h1>
          </div>
          <div className="hidden lg:flex items-baseline gap-5">
            {desktop && (
              <span className="font-mono text-[11px] text-cream-subtle">↓ ↑ move · Enter open · Esc close</span>
            )}
            {brief && (
              <Link
                href="/cre-os/today/brief"
                className="font-heading text-[12px] font-semibold text-coral-400 hover:text-coral-500"
              >
                Read Steward&apos;s full brief →
              </Link>
            )}
          </div>
        </header>

        {brief && (
          <section className="border-l-[3px] border-coral-400 bg-steward-surface px-4 py-3 max-w-3xl">
            <div className="font-heading text-[10px] font-bold uppercase tracking-eyebrow text-coral-400">Steward</div>
            <p className="mt-1 font-body text-[15px] leading-[1.5] text-cream">{brief.lede}</p>
            <Link
              href="/cre-os/today/brief"
              className="mt-2 inline-block lg:hidden font-heading text-[12px] font-semibold text-coral-400 hover:text-coral-500"
            >
              Read the brief →
            </Link>
          </section>
        )}

        {/* Phone: the queue. Desktop: queue | conversation. */}
        <div className="lg:grid lg:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] xl:grid-cols-[520px_minmax(0,1fr)] lg:gap-6 lg:items-start">
          <div className="min-w-0">{queue}</div>

          {desktop && (
            <div className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100dvh-10.5rem)]">
              {open ? (
                <ThreadPanel
                  key={open.id}
                  variant="inline"
                  leadId={open.leadId}
                  contactId={open.contactId}
                  initialChannel={open.channel}
                  onClose={() => setOpen(null)}
                />
              ) : (
                <div className="h-full flex items-center justify-center border-l-2 border-cream bg-steward-surface">
                  <p className="font-body text-[15px] text-cream-muted">Pick someone on the left.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!desktop && open && (
        <ThreadPanel
          leadId={open.leadId}
          contactId={open.contactId}
          initialChannel={open.channel}
          onClose={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </AppShell>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between border-b-2 border-cream pb-2">
        <h2 className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream">{label}</h2>
        <span className="font-mono text-[13px] font-semibold text-coral-400">{count}</span>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 font-body text-[15px] text-cream-muted">{children}</p>;
}

function Row({
  row,
  primary = false,
  selected = false,
  onOpen,
  onDismiss,
}: {
  row: TodayRow;
  primary?: boolean;
  selected?: boolean;
  onOpen: (r: TodayRow) => void;
  onDismiss: (r: TodayRow, how: Dismiss) => void;
}) {
  const [menu, setMenu] = useState(false);
  const channel = CHANNEL_WORD[row.channel] ?? row.channel;
  return (
    <div
      className={`border-b border-white/[0.06] ${
        selected ? "bg-copper-100 border-l-[3px] border-l-coral-400" : "bg-steward-surface border-l-[3px] border-l-transparent"
      }`}
      aria-current={selected ? "true" : undefined}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <button
          type="button"
          onClick={() => onOpen(row)}
          className="min-w-0 flex-1 flex items-center gap-3 text-left"
        >
          <span className="w-9 h-9 shrink-0 rounded-full bg-ink-200 text-ink-900 flex items-center justify-center font-heading text-[12px] font-bold">
            {initials(row.who)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-heading text-[15px] font-semibold text-cream truncate">{row.who}</span>
            <span className="block font-body text-[13px] text-cream-muted truncate">
              {row.property && (
                <span className="mr-2 inline-block bg-ink-200 px-1.5 py-px font-heading text-[10px] font-bold uppercase tracking-eyebrow text-ink-700 align-[1px]">
                  {row.property}
                </span>
              )}
              <span className="text-cream">{row.what}</span>
              <span> · {channel} · {row.when}</span>
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => onOpen(row)}
          className={`shrink-0 px-3 py-2 font-heading text-[12px] font-semibold ${
            primary ? "bg-copper-600 text-white hover:bg-copper-700" : "bg-ink-200 text-ink-900 hover:bg-ink-300"
          }`}
        >
          {row.action}
        </button>
        <button
          type="button"
          onClick={() => setMenu((v) => !v)}
          aria-label={`More for ${row.who}`}
          aria-expanded={menu}
          className="shrink-0 w-9 h-9 flex items-center justify-center font-mono text-[18px] leading-none text-cream-muted hover:text-cream"
        >
          ⋯
        </button>
      </div>
      {menu && (
        <div className="flex items-center gap-2 px-3 pb-3 pl-[60px]">
          <DismissButton label="Clear" hint="done with it" onClick={() => onDismiss(row, "clear")} />
          {row.leadId && <DismissButton label="Archive" onClick={() => onDismiss(row, "archive")} />}
          {row.leadId && <DismissButton label="Spam" onClick={() => onDismiss(row, "spam")} />}
        </div>
      )}
    </div>
  );
}

function DismissButton({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      className="px-3 py-1.5 border border-cream font-heading text-[12px] font-semibold text-cream hover:bg-cream hover:text-steward-base transition-colors"
    >
      {label}
    </button>
  );
}
