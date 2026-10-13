"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { ThreadPanel } from "@/components/cre-os/comms/ThreadPanel";

/**
 * TodayView — the kitchen. No dashboard, no rails, no hot/warm badges: a
 * list of decisions, waiting-first, with the reply one tap away.
 *
 * Brand: Bone canvas, White rows, Archivo, 2px Ink section rules, one
 * Copper action per row. Zero radius.
 */

export interface TodayRow {
  id: string;
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

export function TodayView({
  waiting,
  next,
  brief,
}: {
  waiting: TodayRow[];
  next: TodayRow[];
  brief: { lede: string; date: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<TodayRow | null>(null);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const openRow = (r: TodayRow) => {
    if (!r.leadId && !r.contactId) return;
    setOpen(r);
  };

  return (
    <AppShell>
      <div className="max-w-3xl space-y-8">
        <header>
          <div className="font-heading text-[11px] font-bold uppercase tracking-eyebrow text-cream-muted">{today}</div>
          <h1 className="mt-1 font-display text-[30px] font-extrabold text-cream leading-none">Today</h1>
        </header>

        {brief && (
          <section className="border-l-[3px] border-coral-400 bg-steward-surface px-4 py-3">
            <div className="font-heading text-[10px] font-bold uppercase tracking-eyebrow text-coral-400">Steward</div>
            <p className="mt-1 font-body text-[15px] leading-[1.5] text-cream">{brief.lede}</p>
            <Link
              href="/cre-os/today/brief"
              className="mt-2 inline-block font-heading text-[12px] font-semibold text-coral-400 hover:text-coral-500"
            >
              Read the brief →
            </Link>
          </section>
        )}

        <Section label="Waiting on you" count={waiting.length}>
          {waiting.length === 0 ? (
            <Empty>Nobody is waiting on you.</Empty>
          ) : (
            waiting.map((r) => <Row key={r.id} row={r} primary onOpen={openRow} />)
          )}
        </Section>

        <Section label="Next up" count={next.length}>
          {next.length === 0 ? (
            <Empty>Nothing queued. The pipeline and people pages have the rest.</Empty>
          ) : (
            next.map((r) => <Row key={r.id} row={r} onOpen={openRow} />)
          )}
        </Section>
      </div>

      {open && (
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

function Row({ row, primary = false, onOpen }: { row: TodayRow; primary?: boolean; onOpen: (r: TodayRow) => void }) {
  const channel = CHANNEL_WORD[row.channel] ?? row.channel;
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="w-full flex items-center gap-3 border-b border-white/[0.06] bg-steward-surface px-3 py-3 text-left hover:bg-white/[0.03] transition-colors"
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
      <span
        className={`shrink-0 px-3 py-2 font-heading text-[12px] font-semibold ${
          primary ? "bg-copper-600 text-white" : "bg-ink-200 text-ink-900"
        }`}
      >
        {row.action}
      </span>
    </button>
  );
}
