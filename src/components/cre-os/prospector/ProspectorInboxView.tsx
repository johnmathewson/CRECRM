"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { SendTouchDialog } from "@/components/cre-os/prospector/SendTouchDialog";
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

// AI-classified reply intents — short label + tone for badge rendering
const INTENT_LABEL: Record<string, string> = {
  interested: "Interested",
  question: "Question",
  declined: "Declined",
  hostile: "Hostile",
  unsubscribe: "Unsubscribe",
  out_of_office: "OOO",
  unclear: "Unclear",
};

const INTENT_TONE: Record<string, string> = {
  interested: "text-teal-300 border-teal-400/40 bg-teal-400/[0.10]",
  question: "text-amber border-amber/40 bg-amber/[0.10]",
  declined: "text-cream-dim border-white/[0.12] bg-white/[0.04]",
  hostile: "text-coral-300 border-coral-400/50 bg-coral-400/[0.12]",
  unsubscribe: "text-coral-300 border-coral-400/40 bg-coral-400/[0.08]",
  out_of_office: "text-cream-subtle border-white/[0.08] bg-white/[0.02]",
  unclear: "text-cream-subtle border-white/[0.06] bg-white/[0.02]",
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
  const [composeOpen, setComposeOpen] = useState(false);

  // Deep-link support: if the URL has ?touch=<id>, auto-open that touch's
  // detail panel. Used by the Leads-tab "View reply & respond →" links so
  // the broker lands right where they can read the reply + send a response.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const touchId = params.get("touch");
    if (!touchId) return;
    const match = snapshot.touches.find((t) => t.id === touchId);
    if (match) {
      setSelected(match);
      // Scroll the detail panel into view after the initial paint
      setTimeout(() => {
        const el = document.querySelector('[data-touch-detail-panel="true"]');
        if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } else {
      // Touch isn't in the current snapshot (filtered out). Fetch it directly.
      fetch(`/api/lane-touches/${touchId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => { if (data?.touch) setSelected(data.touch); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <RailStat label="Replied (in inbox)" value={snapshot.totals.repliesUnread.toString()} tone="coral" />
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
            href="/cre-os/inbox"
            className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.06] hover:bg-coral-400/[0.12] font-body text-[11px] text-coral-300 hover:text-coral-200"
          >
            View inbox (replies) →
          </Link>
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
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Eyebrow tone="coral">Prospector · Cadence Manager</Eyebrow>
            <Link href="/cre-os/prospector" className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream">
              ← Back to Prospector
            </Link>
            <h1 className="mt-1 font-display font-medium text-2xl text-cream">Cadence Manager</h1>
            <p className="mt-2 font-heading text-[13px] text-cream-dim leading-relaxed max-w-3xl">
              Every outbound touch the agent has sent — what's queued, what's been delivered, what's waiting on a reply.
              When a contact writes back, it surfaces in your <Link href="/cre-os/inbox" className="text-coral-300 hover:text-coral-200 underline underline-offset-2">main inbox</Link> as a re-opened lead.
            </p>
          </div>
          <button
            onClick={() => setComposeOpen(true)}
            className="shrink-0 px-4 py-2.5 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="w-4 h-4">
              <path d="M12 4v16M4 12h16" strokeLinecap="round" />
            </svg>
            Compose
          </button>
        </header>

        {/* Filter chips — outbound cadence states only.
            Replies are handled in the main inbox, not here. */}
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
            label="Failed"
            active={activeFilters.status === "failed"}
            tone="amber"
            onClick={() => applyFilter({ status: "failed" })}
          />
          {/* Replies go to the main inbox — surface the count as a link, not a filter */}
          {snapshot.totals.repliesUnread > 0 && (
            <Link
              href="/cre-os/inbox"
              className="px-2.5 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.08] font-mono text-[10.5px] uppercase tracking-eyebrow text-coral-300 hover:bg-coral-400/[0.16]"
            >
              {snapshot.totals.repliesUnread} {snapshot.totals.repliesUnread === 1 ? "reply" : "replies"} → open inbox
            </Link>
          )}

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

      <SendTouchDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
      />
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
            <div className="shrink-0 flex items-center gap-3">
              {/* Replied touches are handled in the main inbox — surface a direct link */}
              {isReply && (
                <Link
                  href="/cre-os/inbox"
                  onClick={(e) => e.stopPropagation()}
                  className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300 hover:text-coral-200"
                  title="Reply surfaced in your main inbox — open to read and respond"
                >
                  View in inbox →
                </Link>
              )}
              <span className="font-mono text-[10px] text-cream-subtle">
                {fmtRelative(stamp)}
              </span>
            </div>
          </div>
          <div className="font-body text-[11.5px] text-cream-dim truncate mb-1.5">
            {touch.bodyPreview ?? <span className="italic text-cream-subtle">No body</span>}
          </div>
          {/* AI-read summary on inbound replies — at-a-glance triage */}
          {isReply && touch.classification && touch.classification.intent !== "unclear" && (
            <div className="mb-1.5 flex items-start gap-2">
              <span className={`shrink-0 font-mono text-[9px] uppercase tracking-eyebrow border px-1.5 py-0.5 rounded ${INTENT_TONE[touch.classification.intent]}`}>
                {INTENT_LABEL[touch.classification.intent]}
              </span>
              <span className="font-body text-[11px] text-cream-dim italic truncate">
                AI read: {touch.classification.summary}
              </span>
            </div>
          )}
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

  const isReply = touch.direction === "inbound";

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
    <div data-touch-detail-panel="true">
    <Panel
      eyebrow={isReply ? "Reply received" : "Sent"}
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

        {/* AI classification block — only on inbound replies */}
        {isReply && touch.classification && (
          <div className="rounded border border-coral-400/25 bg-coral-400/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-mono text-[9.5px] uppercase tracking-eyebrow border px-1.5 py-0.5 rounded ${INTENT_TONE[touch.classification.intent] ?? INTENT_TONE.unclear}`}>
                {INTENT_LABEL[touch.classification.intent] ?? "Unclear"}
              </span>
              <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
                Confidence {(touch.classification.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="font-body text-[12px] text-cream-dim leading-relaxed italic">
              {touch.classification.summary}
            </div>
            {touch.classification.nextAction && (
              <div className="mt-2 font-body text-[11.5px] text-cream">
                <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">Next →</span>{" "}
                {touch.classification.nextAction}
              </div>
            )}
          </div>
        )}

        <div className="rounded border border-white/[0.05] bg-white/[0.02] p-4">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-2">Body</div>
          {loading && <div className="text-cream-subtle text-[11.5px] italic">Loading…</div>}
          {!loading && (
            <pre className="font-body text-[12.5px] text-cream-dim leading-relaxed whitespace-pre-wrap">
              {fullBody ?? touch.bodyPreview ?? <span className="italic text-cream-subtle">No body content</span>}
            </pre>
          )}
        </div>

        {/* Reply redirect — replies are handled in the main inbox, not here.
            Show the AI classification summary + a direct link to the inbox. */}
        {isReply && (
          <div className="rounded border border-coral-400/30 bg-coral-400/[0.04] p-4">
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300 font-semibold mb-2">
              Reply received — handle in your inbox
            </div>
            {touch.classification?.summary && (
              <p className="font-body text-[12.5px] text-cream-dim leading-relaxed mb-3 italic">
                AI read: {touch.classification.summary}
              </p>
            )}
            <p className="font-body text-[12px] text-cream-subtle leading-relaxed mb-4">
              This reply has surfaced in your main inbox as a re-opened lead. Read the full message
              and send your response from there — it keeps the thread, AI draft, and contact history all together.
            </p>
            <Link
              href="/cre-os/inbox"
              className="inline-flex items-center gap-2 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-mono text-[10.5px] uppercase tracking-eyebrow text-coral-300"
            >
              Open inbox →
            </Link>
          </div>
        )}
      </div>
    </Panel>
    </div>
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
