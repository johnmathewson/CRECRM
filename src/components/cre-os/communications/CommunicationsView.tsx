"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { KpiTile } from "@/components/cre-os/KpiTile";
// Import from the types module, NOT communications-queries — that file
// pulls in next/headers via the Supabase server client, which can't be
// bundled into a client component.
import {
  TOUCH_KIND_LABEL,
  CHANNEL_LABEL,
  type CommsSnapshot,
  type CommsRow,
} from "@/lib/cre-os/communications-types";

/**
 * CommunicationsView — every email in one filterable place.
 *
 * Answers the questions the CRM couldn't before: what went out, of what
 * kind, on which property, and did anyone write back. All state lives in
 * the URL so a filtered view is shareable and survives refresh.
 *
 * Layout:
 *   1. KPI row — outbound / inbound / reply rate / distinct recipients
 *   2. Kind chips — AI follow-up · Campaign · Manual · Auto-ack · Internal
 *   3. Filters — property, direction, date range, free text
 *   4. Per-property rollup — where the activity is concentrated
 *   5. Message list — newest first
 */

const KIND_TONE: Record<string, string> = {
  ai_followup: "border-coral-400/40 bg-coral-400/[0.10] text-coral-300",
  campaign: "border-teal-400/40 bg-teal-400/[0.10] text-teal-300",
  manual: "border-amber-400/40 bg-amber-400/[0.10] text-amber-300",
  auto_ack: "border-white/[0.10] bg-white/[0.03] text-cream-dim",
  internal: "border-white/[0.08] bg-white/[0.02] text-cream-subtle",
  unclassified: "border-white/[0.06] bg-white/[0.01] text-cream-subtle",
};

const KIND_ORDER = ["ai_followup", "campaign", "manual", "auto_ack", "internal"];

const CHANNEL_ORDER = ["email", "website", "sms", "phone", "calendar", "voice"];

const CHANNEL_TONE: Record<string, string> = {
  email: "border-white/[0.10] bg-white/[0.03] text-cream-dim",
  website: "border-violet-400/40 bg-violet-400/[0.10] text-violet-300",
  sms: "border-sky-400/40 bg-sky-400/[0.10] text-sky-300",
  phone: "border-emerald-400/40 bg-emerald-400/[0.10] text-emerald-300",
  calendar: "border-white/[0.08] bg-white/[0.02] text-cream-subtle",
  voice: "border-white/[0.08] bg-white/[0.02] text-cream-subtle",
  manual_test: "border-white/[0.06] bg-white/[0.01] text-cream-subtle",
};

export function CommunicationsView({ snapshot }: { snapshot: CommsSnapshot }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { rows, summary, byProperty, propertyOptions, truncated } = snapshot;

  const activeKind = searchParams?.get("kind") ?? "all";
  const activeChannel = searchParams?.get("channel") ?? "all";
  const activeDirection = searchParams?.get("direction") ?? "all";
  const activeProperty = searchParams?.get("property") ?? "";
  const activeSince = searchParams?.get("since") ?? "";
  const activeUntil = searchParams?.get("until") ?? "";
  const activeQ = searchParams?.get("q") ?? "";

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || v === "all") params.delete(k);
        else params.set(k, v);
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?");
    },
    [router, searchParams],
  );

  const hasFilters =
    activeKind !== "all" ||
    activeChannel !== "all" ||
    activeDirection !== "all" ||
    !!activeProperty ||
    !!activeSince ||
    !!activeUntil ||
    !!activeQ;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <header>
          <Eyebrow tone="coral">Communications · Every touch</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">
            Communication log
          </h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            {summary.outbound.toLocaleString()} sent ·{" "}
            {summary.inbound.toLocaleString()} received
            {summary.replyRatePct !== null && (
              <> · {summary.replyRatePct}% reply rate on real outreach</>
            )}
            {summary.firstAt && summary.lastAt && (
              <span className="text-cream-subtle">
                {" "}
                · {new Date(summary.firstAt).toLocaleDateString()} –{" "}
                {new Date(summary.lastAt).toLocaleDateString()}
              </span>
            )}
          </p>
        </header>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile
            label="Sent"
            value={summary.outbound.toLocaleString()}
            caption="Outbound touches"
          />
          <KpiTile
            label="Received"
            value={summary.inbound.toLocaleString()}
            caption="Inbound replies"
          />
          <KpiTile
            label="Reply rate"
            value={summary.replyRatePct !== null ? `${summary.replyRatePct}%` : "—"}
            caption="Excludes internal + auto-ack"
          />
          <KpiTile
            label="People reached"
            value={summary.distinctRecipients.toLocaleString()}
            caption="Distinct recipients"
          />
        </div>

        {/* Kind chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle mr-1">
            Kind
          </span>
          <KindChip
            label="All"
            count={summary.outbound}
            active={activeKind === "all"}
            onClick={() => setParams({ kind: null })}
          />
          {KIND_ORDER.map((kind) => {
            const n = summary.byKind[kind] ?? 0;
            if (n === 0 && activeKind !== kind) return null;
            return (
              <KindChip
                key={kind}
                label={TOUCH_KIND_LABEL[kind] ?? kind}
                count={n}
                tone={KIND_TONE[kind]}
                active={activeKind === kind}
                onClick={() => setParams({ kind: activeKind === kind ? null : kind })}
              />
            );
          })}
        </div>

        {/* Channel chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle mr-1">
            Channel
          </span>
          <KindChip
            label="All"
            count={summary.total}
            active={activeChannel === "all"}
            onClick={() => setParams({ channel: null })}
          />
          {CHANNEL_ORDER.map((ch) => {
            const n = summary.byChannel[ch] ?? 0;
            if (n === 0 && activeChannel !== ch) return null;
            return (
              <KindChip
                key={ch}
                label={CHANNEL_LABEL[ch] ?? ch}
                count={n}
                tone={CHANNEL_TONE[ch]}
                active={activeChannel === ch}
                onClick={() =>
                  setParams({ channel: activeChannel === ch ? null : ch })
                }
              />
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <FieldLabel>Search</FieldLabel>
            <input
              type="search"
              defaultValue={activeQ}
              onBlur={(e) => setParams({ q: e.target.value || null })}
              onKeyDown={(e) => {
                if (e.key === "Enter") setParams({ q: e.currentTarget.value || null });
              }}
              placeholder="Subject, body, address…"
              className={inputCls}
            />
          </div>
          <div className="min-w-[200px]">
            <FieldLabel>Property</FieldLabel>
            <select
              value={activeProperty}
              onChange={(e) => setParams({ property: e.target.value || null })}
              className={inputCls}
            >
              <option value="">All properties</option>
              {propertyOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Direction</FieldLabel>
            <select
              value={activeDirection}
              onChange={(e) => setParams({ direction: e.target.value })}
              className={inputCls}
            >
              <option value="all">Both</option>
              <option value="outbound">Sent</option>
              <option value="inbound">Received</option>
            </select>
          </div>
          <div>
            <FieldLabel>From</FieldLabel>
            <input
              type="date"
              value={activeSince}
              onChange={(e) => setParams({ since: e.target.value || null })}
              className={inputCls}
            />
          </div>
          <div>
            <FieldLabel>To</FieldLabel>
            <input
              type="date"
              value={activeUntil}
              onChange={(e) => setParams({ until: e.target.value || null })}
              className={inputCls}
            />
          </div>
          {hasFilters && (
            <button
              onClick={() => router.replace("?")}
              className="px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[10.5px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Per-property rollup */}
        {byProperty.length > 0 && (
          <Panel
            eyebrow="By property"
            num={1}
            title="Where the activity is"
            actions={
              <span className="font-mono text-[10px] text-cream-subtle">
                {byProperty.length} propert{byProperty.length === 1 ? "y" : "ies"}
              </span>
            }
          >
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full font-body text-[12px]">
                <thead>
                  <tr className="text-left font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle border-b border-white/[0.05]">
                    <th className="py-2 pr-3">Property</th>
                    <th className="py-2 pr-3 text-right">Sent</th>
                    <th className="py-2 pr-3 text-right">Received</th>
                    <th className="py-2 pr-3 text-right">AI</th>
                    <th className="py-2 pr-3 text-right">Campaign</th>
                    <th className="py-2 pr-3 text-right">Manual</th>
                    <th className="py-2 pr-3">Last touch</th>
                  </tr>
                </thead>
                <tbody>
                  {byProperty.map((p) => (
                    <tr
                      key={p.propertyId}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02] cursor-pointer"
                      onClick={() => setParams({ property: p.propertyId })}
                    >
                      <td className="py-2.5 pr-3">
                        <span className="font-heading text-[12.5px] text-cream truncate">
                          {p.propertyName}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-cream-dim">
                        {p.outbound}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-cream-dim">
                        {p.inbound}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-coral-300">
                        {p.aiFollowup || "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-teal-300">
                        {p.campaign || "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-amber-300">
                        {p.manual || "—"}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[10.5px] text-cream-subtle">
                        {p.lastTouchRelative}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Coverage check */}
        <CoveragePanel />

        {/* Message list */}
        <Panel
          eyebrow="Messages"
          num={2}
          title={hasFilters ? "Filtered results" : "All messages"}
          actions={
            <span className="font-mono text-[10px] text-cream-subtle">
              {truncated
                ? `showing ${rows.length} of ${summary.total.toLocaleString()}`
                : `${rows.length.toLocaleString()}`}
            </span>
          }
        >
          {rows.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-10 text-center">
              No messages match these filters.
            </p>
          ) : (
            <div className="space-y-1.5">
              {rows.map((r) => (
                <MessageRow key={r.id} row={r} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface CoverageSide {
  inGmail: number;
  logged: number;
  missing: number;
  coveragePct: number;
  truncated: boolean;
  /** Inbound only — gaps the poller saw and intentionally skipped, by reason */
  explained?: Record<string, number>;
  /** Inbound only — gaps missing from communications AND the ingest log */
  unexplained?: number;
  sample: {
    gmailMessageId: string;
    subject: string | null;
    counterparty: string | null;
    date: string | null;
    disposition?: string | null;
  }[];
}

interface SpamReview {
  inGmail: number;
  reviewed: number;
  truncated: boolean;
  knownSenders: {
    gmailMessageId: string;
    from: string | null;
    subject: string | null;
    date: string | null;
    matchedIn: string[];
  }[];
}

interface CoverageResult {
  window: { days: number; since: string };
  mailbox: string;
  outbound: CoverageSide;
  inbound: CoverageSide;
  spam?: SpamReview;
  notes: string[];
  error?: string;
}

interface BackfillResult {
  attempted: number;
  remaining: number;
  backfilled: number;
  skippedAlreadyLogged: number;
  errors: { gmailMessageId: string; error: string }[];
  error?: string;
}

/** Human labels for ingest-log dispositions shown in the coverage panel. */
const DISPOSITION_LABEL: Record<string, string> = {
  routed_as_reply: "Routed as reply",
  crexi_report: "CREXi report",
  lead_intake: "Lead intake",
  intake_rejected: "Intake rejected",
  dropped_by_classifier: "Classifier drop",
  unsubscribe: "Unsubscribe",
  skipped_label: "Spam/trash label",
  skipped_self: "Self-mail",
  error: "Ingest error",
};

/**
 * Coverage check — reconciles Gmail against the log so "nothing falls
 * through the cracks" is a number rather than an assumption.
 *
 * Deliberately on-demand, not on page load: it pages through Gmail and
 * hydrates message headers, which is too slow and too many API calls to
 * run every time the dashboard opens.
 */
function CoveragePanel() {
  const [result, setResult] = useState<CoverageResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<BackfillResult | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setBackfill(null);
    try {
      const r = await fetch(`/api/communications/coverage?days=${days}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as CoverageResult;
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setResult(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runBackfill() {
    setBackfillBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/communications/coverage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const j = (await r.json()) as BackfillResult;
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      // Re-run the check so the cards reflect the repaired state, then show
      // the backfill summary on top of the fresh numbers.
      await run();
      setBackfill(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBackfillBusy(false);
    }
  }

  const totalMissing = result
    ? result.outbound.missing + result.inbound.missing
    : 0;

  return (
    <Panel
      eyebrow="Coverage"
      title="Is anything falling through?"
      actions={
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-2 py-1 rounded border border-white/[0.08] bg-white/[0.02] font-mono text-[10px] text-cream-dim focus:outline-none focus:border-coral-400/40"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            onClick={run}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[10.5px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors disabled:opacity-50"
          >
            {busy ? "Checking…" : "Run check"}
          </button>
        </div>
      }
    >
      {!result && !error && !busy && (
        <p className="font-body text-[12.5px] text-cream-subtle py-2">
          Compares every message in Gmail over the window against what&apos;s in
          this log. Anything in Gmail with no matching row is a gap.
        </p>
      )}

      {error && (
        <div className="rounded border border-red-400/40 bg-red-500/[0.08] px-3 py-2 font-body text-[12px] text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CoverageCard label="Sent" side={result.outbound} />
            <CoverageCard label="Received" side={result.inbound} />
          </div>

          {/* Inbound gap explanation — seen-and-skipped vs never-seen */}
          {result.inbound.missing > 0 && (
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
                Why inbound is missing
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(result.inbound.explained ?? {}).map(([d, n]) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.03] font-mono text-[9.5px] text-cream-dim"
                  >
                    {DISPOSITION_LABEL[d] ?? d}
                    <span className="tabular-nums opacity-70">{n}</span>
                  </span>
                ))}
                {(result.inbound.unexplained ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-400/35 bg-amber-400/[0.08] font-mono text-[9.5px] text-amber-300">
                    Unexplained
                    <span className="tabular-nums">{result.inbound.unexplained}</span>
                  </span>
                )}
              </div>
              <p className="font-body text-[10.5px] text-cream-subtle">
                Explained gaps were seen and intentionally skipped. Unexplained
                gaps predate the ingest log or need a look — Backfill logs them.
              </p>
            </div>
          )}

          {/* Backfill */}
          {totalMissing > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={runBackfill}
                disabled={backfillBusy || busy}
                className="px-3 py-1.5 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.18] font-heading text-[10.5px] uppercase tracking-eyebrow font-semibold text-teal-300 transition-colors disabled:opacity-50"
              >
                {backfillBusy
                  ? "Backfilling…"
                  : `Backfill ${totalMissing.toLocaleString()} missing`}
              </button>
              <span className="font-body text-[10.5px] text-cream-subtle">
                Writes each missing message into the log, matched to contact +
                lead + property by email. Runs in batches — click again if any
                remain.
              </span>
            </div>
          )}
          {backfill && (
            <div className="rounded border border-teal-400/30 bg-teal-400/[0.05] px-3 py-2 font-mono text-[11px] text-teal-300 tabular-nums">
              Backfilled {backfill.backfilled} · already logged{" "}
              {backfill.skippedAlreadyLogged} · errors {backfill.errors.length}
              {backfill.remaining > 0 && <> · {backfill.remaining} remaining — run again</>}
            </div>
          )}

          {(result.outbound.sample.length > 0 ||
            result.inbound.sample.length > 0) && (
            <div className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
                Not in the log
              </div>
              {[
                ...result.outbound.sample.map((s) => ({ ...s, dir: "sent" as const })),
                ...result.inbound.sample.map((s) => ({ ...s, dir: "received" as const })),
              ].map((s) => (
                <div
                  key={s.gmailMessageId}
                  className="rounded border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-heading text-[12px] text-cream truncate">
                      {s.subject || "(no subject)"}
                    </span>
                    <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-eyebrow text-amber-300">
                      {s.dir}
                      {s.disposition && (
                        <span className="ml-1.5 text-cream-subtle normal-case">
                          {DISPOSITION_LABEL[s.disposition] ?? s.disposition}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">
                    {s.counterparty ?? "unknown"}
                    {s.date && (
                      <span className="ml-2">
                        {new Date(s.date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Spam review — real relationships buried by Gmail */}
          {result.spam && (
            <div className="space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
                Spam folder · {result.spam.inGmail} messages,{" "}
                {result.spam.reviewed} reviewed
              </div>
              {result.spam.knownSenders.length === 0 ? (
                <p className="font-body text-[11px] text-cream-subtle">
                  No known contacts or leads found in spam.
                </p>
              ) : (
                result.spam.knownSenders.map((s) => (
                  <div
                    key={s.gmailMessageId}
                    className="rounded border border-red-400/30 bg-red-500/[0.05] px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-heading text-[12px] text-cream truncate">
                        {s.subject || "(no subject)"}
                      </span>
                      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-eyebrow text-red-300">
                        known {s.matchedIn.join(" + ")}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">
                      {s.from ?? "unknown"}
                      {s.date && (
                        <span className="ml-2">
                          {new Date(s.date).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {result.notes.length > 0 && (
            <ul className="space-y-1 pt-1 border-t border-white/[0.06]">
              {result.notes.map((n, i) => (
                <li key={i} className="font-body text-[11px] text-cream-subtle">
                  · {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function CoverageCard({ label, side }: { label: string; side: CoverageSide }) {
  const clean = side.missing === 0;
  return (
    <div
      className={`rounded border px-4 py-3 ${
        clean
          ? "border-teal-400/30 bg-teal-400/[0.05]"
          : "border-amber-400/35 bg-amber-400/[0.06]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
          {label}
        </span>
        <span
          className={`font-display text-xl tabular-nums ${
            clean ? "text-teal-300" : "text-amber-300"
          }`}
        >
          {side.coveragePct}%
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-cream-dim tabular-nums">
        {side.logged.toLocaleString()} of {side.inGmail.toLocaleString()} logged
        {side.missing > 0 && (
          <span className="text-amber-300">
            {" "}
            · {side.missing.toLocaleString()} missing
          </span>
        )}
      </div>
      {side.truncated && (
        <div className="mt-1 font-mono text-[9.5px] text-amber-300/80">
          Gmail returned more than the page cap — widen with care.
        </div>
      )}
    </div>
  );
}

const inputCls =
  "w-full px-2.5 py-2 rounded border border-white/[0.08] bg-white/[0.02] font-body text-[12.5px] text-cream focus:outline-none focus:border-coral-400/50 focus:bg-coral-400/[0.03] transition-colors";

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
      {children}
    </div>
  );
}

function KindChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: string;
  onClick: () => void;
}) {
  const base = tone ?? "border-white/[0.08] bg-white/[0.02] text-cream-dim";
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-[10px] uppercase tracking-eyebrow transition-colors ${
        active
          ? `${base} ring-1 ring-inset ring-current`
          : `${base} opacity-60 hover:opacity-100`
      }`}
    >
      {label}
      <span className="tabular-nums opacity-70">{count.toLocaleString()}</span>
    </button>
  );
}

function MessageRow({ row }: { row: CommsRow }) {
  const isInbound = row.direction === "inbound";
  const counterparty = isInbound
    ? row.fromAddress ?? row.contact?.email ?? "unknown sender"
    : row.toAddresses[0] ?? row.contact?.email ?? "unknown recipient";

  return (
    <div
      className={`rounded border px-3.5 py-3 transition-colors ${
        isInbound
          ? "border-l-2 border-l-teal-400/50 border-y-white/[0.05] border-r-white/[0.05] bg-teal-400/[0.02]"
          : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
              {isInbound ? "← received" : "→ sent"}
            </span>
            {row.channel !== "email" && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-eyebrow ${
                  CHANNEL_TONE[row.channel] ?? CHANNEL_TONE.email
                }`}
              >
                {CHANNEL_LABEL[row.channel] ?? row.channel}
              </span>
            )}
            {row.touchKind && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-eyebrow ${
                  KIND_TONE[row.touchKind] ?? KIND_TONE.unclassified
                }`}
              >
                {TOUCH_KIND_LABEL[row.touchKind] ?? row.touchKind}
              </span>
            )}
            {row.property && (
              <Link
                href={`/cre-os/properties/${row.property.slug}`}
                className="font-mono text-[10px] text-cream-subtle hover:text-coral-300 underline underline-offset-2 truncate max-w-[240px]"
              >
                {row.property.name}
              </Link>
            )}
          </div>
          <div className="mt-1 font-heading text-[13px] text-cream truncate">
            {row.subject || "(no subject)"}
          </div>
          {row.bodyPreview && (
            <p className="mt-1 font-body text-[11.5px] text-cream-dim line-clamp-2">
              {row.bodyPreview}
            </p>
          )}
          {row.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {row.attachments.map((a, i) => (
                <span
                  key={`${a.filename}-${i}`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.03] font-mono text-[9.5px] text-cream-dim max-w-[220px]"
                  title={`${a.filename}${a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ""}`}
                >
                  <span aria-hidden>📎</span>
                  <span className="truncate">{a.filename}</span>
                  {a.sizeBytes != null && (
                    <span className="text-cream-subtle shrink-0">
                      {formatBytes(a.sizeBytes)}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="mt-1.5 font-mono text-[10px] text-cream-subtle truncate">
            {isInbound ? "from" : "to"} {counterparty}
            {row.contact?.name && (
              <span className="ml-1.5 text-cream-dim">· {row.contact.name}</span>
            )}
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-cream-subtle whitespace-nowrap">
          {row.occurredRelative}
        </span>
      </div>
    </div>
  );
}
