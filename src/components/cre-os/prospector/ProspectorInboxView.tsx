"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type {
  InboxSnapshot,
  InboxTouch,
  InboxFilters,
} from "@/lib/cre-os/prospector-inbox-queries";
import type { Lane } from "@/lib/cre-os/prospector-queries";

const CHANNEL_ICON: Record<string, string> = {
  email: "✉",
  sms: "✆",
  call: "☎",
  letter: "✉",
  voicemail: "▶",
};

const STATUS_TONE: Record<string, string> = {
  sent: "text-cream border-white/[0.10] bg-white/[0.02]",
  queued: "text-amber border-amber/30 bg-amber/[0.06]",
  drafted: "text-amber border-amber/30 bg-amber/[0.06]",
  approved: "text-teal-300 border-teal-400/30 bg-teal-400/[0.05]",
  responded: "text-coral-300 border-coral-400/40 bg-coral-400/[0.08]",
  failed: "text-amber border-amber/40 bg-amber/[0.08]",
  skipped: "text-cream-subtle border-white/[0.06]",
};

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export function ProspectorInboxView({
  snapshot: initial,
  lanes,
  activeFilters,
}: {
  snapshot: InboxSnapshot;
  lanes: Lane[];
  activeFilters: InboxFilters;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initial);
  const [selected, setSelected] = useState<InboxTouch | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [searchInput, setSearchInput] = useState(activeFilters.q ?? "");

  // Live refresh — pulls fresh snapshot every 30s while the page is open.
  useEffect(() => {
    if (!autoRefresh) return;
    const tick = async () => {
      try {
        const params = new URLSearchParams();
        if (activeFilters.status && activeFilters.status !== "all") params.set("status", activeFilters.status);
        if (activeFilters.laneId) params.set("lane", activeFilters.laneId);
        if (activeFilters.q) params.set("q", activeFilters.q);
        const r = await fetch(`/api/prospector/inbox?${params.toString()}`, { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          setSnapshot(data);
        }
      } catch {
        // best-effort; next tick will retry
      }
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [autoRefresh, activeFilters]);

  function applyFilter(patch: Partial<{ status: string; lane: string; q: string }>) {
    const next: Record<string, string> = {};
    if (activeFilters.status && activeFilters.status !== "all") next.status = activeFilters.status;
    if (activeFilters.laneId) next.lane = activeFilters.laneId;
    if (activeFilters.q) next.q = activeFilters.q;
    Object.assign(next, patch);
    // Strip "all" status — it's the default
    if (next.status === "all") delete next.status;
    const qs = new URLSearchParams(next).toString();
    router.push(`/cre-os/prospector/inbox${qs ? "?" + qs : ""}`);
  }

  const rail: RailSection[] = [
    {
      eyebrow: "Today",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Sent today" value={snapshot.totals.sentToday.toString()} />
          <RailStat label="Sent this week" value={snapshot.totals.sent7d.toString()} />
          <RailStat label="Awaiting reply" value={snapshot.totals.awaitingReply.toString()} />
          <RailStat label="Replies" value={snapshot.totals.repliesUnread.toString()} tone="coral" />
          <RailStat label="Drafts queued" value={snapshot.totals.drafted.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "Live",
      children: (
        <label className="flex items-center gap-2 cursor-pointer text-[11px] font-body text-cream-dim">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-coral-400"
          />
          Auto-refresh every 30s
        </label>
      ),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <Link
            href="/cre-os/prospector"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream"
          >
            ← Back to Prospector
          </Link>
          <Link
            href="/cre-os/prospector/inventory"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream"
          >
            Browse cold inventory →
          </Link>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-5">
        <header>
          <Eyebrow tone="coral">Prospector · Inbox</Eyebrow>
          <Link href="/cre-os/prospector" className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream">
            ← Back to Prospector
          </Link>
          <h1 className="mt-1 font-display font-medium text-2xl text-cream">Agent's outbound + replies</h1>
          <p className="mt-2 font-heading text-[13px] text-cream-dim leading-relaxed max-w-3xl">
            Every cadence touch the agent has sent — and every reply that's come back. Replies still
            land on the property timeline; this view lets you see the stream live before drilling in.
          </p>
        </header>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            label="All"
            active={!activeFilters.status || activeFilters.status === "all"}
            onClick={() => applyFilter({ status: "all" })}
          />
          <FilterChip
            label="Sent"
            count={snapshot.totals.sent7d}
            active={activeFilters.status === "sent"}
            onClick={() => applyFilter({ status: "sent" })}
          />
          <FilterChip
            label="Drafts"
            count={snapshot.totals.drafted}
            active={activeFilters.status === "drafted"}
            onClick={() => applyFilter({ status: "drafted" })}
          />
          <FilterChip
            label="Replies"
            count={snapshot.totals.repliesUnread}
            active={activeFilters.status === "replied"}
            tone="coral"
            onClick={() => applyFilter({ status: "replied" })}
          />
          <FilterChip
            label="Failed"
            active={activeFilters.status === "failed"}
            tone="amber"
            onClick={() => applyFilter({ status: "failed" })}
          />

          <div className="h-5 w-px bg-white/[0.10] mx-1" />

          <select
            value={activeFilters.laneId ?? ""}
            onChange={(e) => applyFilter({ lane: e.target.value || "" })}
            className="px-2.5 py-1 rounded border border-white/[0.08] bg-white/[0.02] font-mono text-[10.5px] uppercase tracking-eyebrow text-cream-dim"
          >
            <option value="">All lanes</option>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <form
            className="ml-auto"
            onSubmit={(e) => { e.preventDefault(); applyFilter({ q: searchInput || "" }); }}
          >
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search subject / body…"
              className="w-56 px-3 py-1.5 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
            />
          </form>
        </div>

        {/* Inbox list */}
        <Panel eyebrow="Stream" num={1} title={`${snapshot.touches.length} touch${snapshot.touches.length === 1 ? "" : "es"}`}>
          {snapshot.touches.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-1.5">
              {snapshot.touches.map((t) => (
                <TouchRow
                  key={t.id}
                  touch={t}
                  selected={selected?.id === t.id}
                  onClick={() => setSelected(t)}
                />
              ))}
            </div>
          )}
        </Panel>

        {/* Detail drawer (below the list rather than side-by-side, for simplicity) */}
        {selected && <TouchDetailPanel touch={selected} onClose={() => setSelected(null)} />}
      </div>
    </AppShell>
  );
}

function TouchRow({
  touch,
  selected,
  onClick,
}: {
  touch: InboxTouch;
  selected: boolean;
  onClick: () => void;
}) {
  const isReply = touch.direction === "inbound";
  const stamp = touch.respondedAt ?? touch.sentAt ?? touch.scheduledAt ?? touch.createdAt;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded border transition-colors px-4 py-3 ${
        selected
          ? "border-coral-400/40 bg-coral-400/[0.05]"
          : isReply
            ? "border-coral-400/25 bg-coral-400/[0.03] hover:bg-coral-400/[0.06]"
            : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Direction arrow + channel */}
        <div className="shrink-0 mt-0.5 flex flex-col items-center gap-1">
          <span className={`font-mono text-[14px] ${isReply ? "text-coral-300" : "text-cream-subtle"}`}>
            {isReply ? "←" : "→"}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">
            {CHANNEL_ICON[touch.channel] ?? "·"} {touch.channel}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3 mb-0.5">
            <div className="font-heading text-[13px] text-cream font-semibold truncate">
              {touch.subject ?? "(no subject)"}
            </div>
            <div className="shrink-0 font-mono text-[10px] text-cream-subtle">
              {fmtRelative(stamp)}
            </div>
          </div>
          <div className="font-body text-[11.5px] text-cream-dim truncate mb-1.5">
            {touch.bodyPreview ?? <span className="italic text-cream-subtle">No body</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[9.5px] uppercase tracking-eyebrow">
            {touch.laneName && (
              <span className="px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.02] text-cream-dim">
                {touch.laneName}
              </span>
            )}
            <span className={`px-1.5 py-0.5 rounded border ${STATUS_TONE[touch.status] ?? STATUS_TONE.sent}`}>
              {touch.status}
            </span>
            <span className="text-cream-subtle normal-case font-body text-[11px]">
              {touch.contactName ?? touch.contactEmail ?? "—"}
              {touch.contactEmail && touch.contactName && (
                <span className="text-cream-subtle/60"> · {touch.contactEmail}</span>
              )}
            </span>
            <span className="text-cream-subtle">·</span>
            <Link
              href={`/cre-os/properties/${touch.propertySlug ?? touch.propertyId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-cream-dim hover:text-coral-300 normal-case font-body text-[11px]"
            >
              {touch.propertyName}
            </Link>
          </div>
        </div>
      </div>
    </button>
  );
}

function TouchDetailPanel({ touch, onClose }: { touch: InboxTouch; onClose: () => void }) {
  const [fullBody, setFullBody] = useState<string | null>(touch.bodyFull ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (touch.bodyFull) return;
    setLoading(true);
    fetch(`/api/lane-touches/${touch.id}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.touch?.bodyFull) setFullBody(data.touch.bodyFull);
      })
      .finally(() => setLoading(false));
  }, [touch.id, touch.bodyFull]);

  return (
    <Panel
      eyebrow={touch.direction === "inbound" ? "Reply received" : "Sent"}
      num={2}
      title={touch.subject ?? "(no subject)"}
      actions={
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded border border-white/[0.08] hover:bg-white/[0.04] font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream"
        >
          Close
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px] font-body">
          <Meta label="Property" value={
            <Link href={`/cre-os/properties/${touch.propertySlug ?? touch.propertyId}`} className="text-coral-300 hover:text-coral-200">
              {touch.propertyName}
            </Link>
          } />
          <Meta label="Contact" value={touch.contactName ?? touch.contactEmail ?? "—"} />
          <Meta label="Lane" value={touch.laneName ?? "—"} />
          <Meta label="Channel" value={touch.channel} />
          <Meta label="Status" value={touch.status} />
          <Meta label="Scheduled" value={touch.scheduledAt ? new Date(touch.scheduledAt).toLocaleString() : "—"} />
          <Meta label="Sent" value={touch.sentAt ? new Date(touch.sentAt).toLocaleString() : "—"} />
          <Meta label="Replied" value={touch.respondedAt ? new Date(touch.respondedAt).toLocaleString() : "—"} />
        </div>

        <div className="rounded border border-white/[0.05] bg-white/[0.02] p-4">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-2">Body</div>
          {loading && <div className="text-cream-subtle text-[11.5px] italic">Loading…</div>}
          {!loading && (
            <pre className="font-body text-[12.5px] text-cream-dim leading-relaxed whitespace-pre-wrap">
              {fullBody ?? touch.bodyPreview ?? <span className="italic text-cream-subtle">No body content</span>}
            </pre>
          )}
        </div>
      </div>
    </Panel>
  );
}

function FilterChip({
  label,
  count,
  active,
  tone = "default",
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  tone?: "default" | "coral" | "amber";
  onClick: () => void;
}) {
  const base = "px-2.5 py-1.5 rounded border font-mono text-[10.5px] uppercase tracking-eyebrow transition-colors";
  const colors = active
    ? tone === "coral"
      ? "border-coral-400/50 bg-coral-400/[0.12] text-coral-300"
      : tone === "amber"
        ? "border-amber/50 bg-amber/[0.12] text-amber"
        : "border-cream/40 bg-white/[0.08] text-cream"
    : "border-white/[0.08] bg-white/[0.02] text-cream-dim hover:bg-white/[0.05]";
  return (
    <button onClick={onClick} className={`${base} ${colors}`}>
      {label}{count !== undefined && count > 0 && <span className="ml-1.5 opacity-70">{count}</span>}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="py-12 text-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-12 h-12 mx-auto text-cream-subtle/40 mb-3">
        <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="font-heading text-[13px] text-cream-dim">No touches yet.</p>
      <p className="mt-1 font-body text-[11.5px] text-cream-subtle max-w-md mx-auto">
        When the agent sends emails (cadence steps) or owners reply, they'll appear here.
        You can also send a one-off touch from any cold-inventory row.
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-0.5 text-cream">{value}</div>
    </div>
  );
}

function RailStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "coral" }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className={`font-mono font-semibold ${tone === "coral" ? "text-coral-300" : "text-cream"}`}>{value}</span>
    </div>
  );
}
