"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { SendTouchDialog } from "@/components/cre-os/prospector/SendTouchDialog";
import type {
  PropertyLeadsSnapshot,
  PropertyLead,
  LeadInterestLevel,
} from "@/lib/cre-os/property-leads-queries";

const INTEREST_LABEL: Record<LeadInterestLevel, string> = {
  executed_ca: "Executed CA",
  offer_submitted: "Offer",
  info_request: "Info Request",
  downloaded_om: "Opened OM",
  visited: "Viewed",
  unknown: "—",
};

const INTEREST_TONE: Record<LeadInterestLevel, string> = {
  executed_ca: "border-coral-400/40 bg-coral-400/[0.10] text-coral-300",
  offer_submitted: "border-coral-400/40 bg-coral-400/[0.10] text-coral-300",
  info_request: "border-amber/40 bg-amber/[0.10] text-amber",
  downloaded_om: "border-teal-400/30 bg-teal-400/[0.05] text-teal-300",
  visited: "border-white/[0.10] bg-white/[0.02] text-cream-dim",
  unknown: "border-white/[0.06] bg-white/[0.01] text-cream-subtle",
};

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return new Date(iso).toLocaleDateString();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Filter buckets follow the lead LIFECYCLE (left → right is what-to-do-next):
//   hot              → engaged high (CA/Offer/Info Request), you haven't emailed yet
//   warm             → engaged but lower signal (OM download, flyer open), untouched
//   touched_waiting  → you sent, no reply yet (any engagement level)
//   replied          → they wrote back; draft is in the Prospector Inbox
//   cold             → only visited the page; mass-email candidates
//   all              → everything
//
// Each filter represents ONE state — no overlaps. A lead lives in exactly
// one bucket at a time, and the bucket changes automatically as the lead's
// state evolves (Compose+Send moves them out of Hot/Warm into Touched, etc.)
type FilterTab = "all" | "hot" | "warm" | "touched_waiting" | "replied" | "cold";

export function LeadsTab({
  snapshot,
  propertyId,
  propertyName,
}: {
  snapshot: PropertyLeadsSnapshot;
  propertyId: string;
  propertyName: string;
}) {
  const { activity, leads, totals } = snapshot;
  const [filter, setFilter] = useState<FilterTab>("hot");
  const [searchQ, setSearchQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composeTarget, setComposeTarget] = useState<PropertyLead | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    attempted: number; sent: number; skipped: number; failed: number;
    dryRun?: boolean;
    sent_rows?: Array<{
      email: string;
      subject?: string;
      body?: string;
      rationale?: string;
      recipientName?: string | null;
    }>;
    skipped_rows?: Array<{ email: string | null; reason: string }>;
    failed_rows?: Array<{ email: string | null; error: string }>;
  } | null>(null);
  const router = useRouter();

  const filtered = useMemo(() => {
    let out = leads;
    const HOT_INTERESTS = ["executed_ca", "offer_submitted", "info_request"];
    const WARM_INTERESTS = ["downloaded_om"]; // OM downloads, flyer opens — engaged but lower signal than hot
    if (filter === "hot") {
      // Hot = hot-interest AND NOT yet touched. After Compose+Send,
      // the lead falls OUT of Hot and into "Touched · waiting".
      out = out.filter((l) => HOT_INTERESTS.includes(l.interest) && !l.lastTouchedAt);
    } else if (filter === "warm") {
      // Warm = mid-engagement (OM download, flyer open) AND untouched.
      // Falls into Touched · waiting after Compose+Send, same as Hot.
      out = out.filter((l) => WARM_INTERESTS.includes(l.interest) && !l.lastTouchedAt);
    } else if (filter === "touched_waiting") {
      // You emailed, they haven't replied — the actual follow-up queue.
      out = out.filter((l) => l.lastTouchedAt && !l.repliedAt);
    } else if (filter === "replied") {
      // They wrote back. Drafts are in the Prospector Inbox.
      out = out.filter((l) => l.repliedAt);
    } else if (filter === "cold") {
      // Page visitors only — never crossed the engagement threshold.
      out = out.filter((l) => l.interest === "visited" || l.interest === "unknown");
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      out = out.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.company?.toLowerCase().includes(q) ||
          l.role?.toLowerCase().includes(q)
      );
    }
    return out;
  }, [leads, filter, searchQ]);

  // Clear selection when filter changes
  useEffect(() => { setSelected(new Set()); }, [filter, searchQ]);

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.id)));
  }

  async function runBulkFollowup(dryRun: boolean) {
    const targets = filtered.filter((l) => selected.has(l.id) && l.email);
    if (targets.length === 0) return;
    const confirmed = dryRun || window.confirm(
      `Send AI-personalized follow-up emails to ${targets.length} ${
        targets.length === 1 ? "recipient" : "recipients"
      }?\n\nEach message is uniquely written for that person based on the property + their engagement.\n\nThis sends real emails. Continue?`
    );
    if (!confirmed) return;

    setBulkBusy(true);
    setBulkResult(null);
    try {
      const r = await fetch("/api/leads/bulk-ai-followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          leadIds: targets.map((l) => l.id),
          dryRun,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setBulkResult({
        attempted: data.attempted,
        sent: data.sent,
        skipped: data.skipped_count,
        failed: data.failed_count,
        dryRun: data.dryRun,
        sent_rows: data.sent_rows,
        skipped_rows: data.skipped,
        failed_rows: data.failed,
      });
      if (!dryRun && data.sent > 0) {
        setSelected(new Set()); // clear selection after a real send
        router.refresh();
      }
    } catch (err) {
      setBulkResult({
        attempted: targets.length,
        sent: 0,
        skipped: 0,
        failed: targets.length,
        failed_rows: [{ email: null, error: err instanceof Error ? err.message : String(err) }],
      });
    } finally {
      setBulkBusy(false);
    }
  }

  const selectedLeads = filtered.filter((l) => selected.has(l.id));
  const selectedWithEmail = selectedLeads.filter((l) => !!l.email);

  return (
    <div className="space-y-5">
      {/* Activity Summary */}
      {activity.reportFreshAt && (
        <Panel eyebrow="Crexi activity (latest report)" num={1} title="Listing engagement">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <Metric label="Page views" value={activity.pageViews} />
            <Metric label="Visitors" value={activity.visitors} />
            <Metric label="Opened OMs" value={activity.openedOmsFlyers} />
            <Metric label="Executed CAs" value={activity.executedCas} tone="coral" />
            <Metric label="Offers" value={activity.offers} tone="coral" />
            <Metric label="Info requests" value={activity.infoRequests} />
          </div>
          <p className="mt-3 font-mono text-[10px] text-cream-subtle">
            Last report: {fmtRelative(activity.reportFreshAt)}
          </p>
        </Panel>
      )}

      {/* Lead pool */}
      <Panel
        eyebrow="Lead pool"
        num={2}
        title={`${totals.leadCount} interested parties`}
      >
        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Stat label="Total" value={totals.leadCount} />
          <Stat label="With email" value={totals.withEmail} tone="teal" />
          <Stat label="With phone" value={totals.withPhone} tone="teal" />
          <Stat label="Hot actions" value={totals.hotActions} tone="coral" />
          <Stat label="Awaiting response" value={totals.awaitingResponse} tone={totals.awaitingResponse > 0 ? "amber" : "default"} />
        </div>

        {/* Filter tabs */}
        {/* Lifecycle helper — quick reference for what each chip means */}
        <p className="mb-2 font-body text-[11px] text-cream-subtle leading-relaxed">
          <strong className="text-cream-dim">Lifecycle:</strong>{" "}
          <span className="text-coral-300">Hot/Warm</span> = engaged, untouched →{" "}
          <span className="text-amber">Touched</span> = you sent, no reply →{" "}
          <span className="text-coral-300">Replied</span> = drafts in Prospector Inbox.{" "}
          <span className="text-cream-subtle">Cold</span> = viewers only.{" "}
          Leads move automatically between buckets — Compose+Send shifts them out of Hot.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* Filter chips follow the lead lifecycle, left → right is what-to-do-next.
              Each chip is mutually exclusive — a lead lives in exactly one state. */}
          <FilterChip
            label="Hot · needs first contact"
            tone="coral"
            active={filter === "hot"}
            onClick={() => setFilter("hot")}
            count={leads.filter((l) => ["executed_ca","offer_submitted","info_request"].includes(l.interest) && !l.lastTouchedAt).length}
          />
          <FilterChip
            label="Warm · needs first contact"
            tone="amber"
            active={filter === "warm"}
            onClick={() => setFilter("warm")}
            count={leads.filter((l) => l.interest === "downloaded_om" && !l.lastTouchedAt).length}
          />
          <FilterChip
            label="Touched · waiting"
            tone="amber"
            active={filter === "touched_waiting"}
            onClick={() => setFilter("touched_waiting")}
            count={leads.filter((l) => l.lastTouchedAt && !l.repliedAt).length}
          />
          <FilterChip
            label="Replied"
            tone="coral"
            active={filter === "replied"}
            onClick={() => setFilter("replied")}
            count={leads.filter((l) => l.repliedAt).length}
          />
          <FilterChip
            label="Cold (viewers only)"
            active={filter === "cold"}
            onClick={() => setFilter("cold")}
            count={leads.filter((l) => l.interest === "visited" || l.interest === "unknown").length}
          />
          <FilterChip label="All" active={filter === "all"} onClick={() => setFilter("all")} count={totals.leadCount} />
          <input
            type="search"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search name, email, company…"
            className="ml-auto w-60 px-3 py-1.5 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
          />
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mb-3 px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.06] flex items-center justify-between gap-3 flex-wrap">
            <div className="font-mono text-[11px] text-coral-300">
              {selected.size} selected
              {selectedWithEmail.length < selected.size && (
                <span className="text-cream-subtle ml-2">
                  ({selectedWithEmail.length} have email — only those can be emailed)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSelected(new Set())}
                disabled={bulkBusy}
                className="px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream disabled:opacity-40"
              >
                Clear
              </button>
              <button
                onClick={() => runBulkFollowup(true)}
                disabled={bulkBusy || selectedWithEmail.length === 0}
                title="Preview without sending"
                className="px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream disabled:opacity-40"
              >
                Dry-run
              </button>
              <button
                onClick={() => runBulkFollowup(false)}
                disabled={bulkBusy || selectedWithEmail.length === 0}
                title="Each recipient gets a uniquely written AI message"
                className="px-4 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-mono text-[10px] uppercase tracking-eyebrow text-coral-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkBusy ? "Sending…" : `Send AI follow-up (${selectedWithEmail.length})`}
              </button>
            </div>
          </div>
        )}

        {/* Bulk result panel */}
        {bulkResult && (
          <div className="mb-3 rounded border border-teal-400/30 bg-teal-400/[0.04] px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300">
                {bulkResult.dryRun ? "Dry-run complete · nothing sent" : "Bulk follow-up complete"}
              </div>
              <button
                onClick={() => setBulkResult(null)}
                className="font-mono text-[10px] text-cream-subtle hover:text-cream"
              >
                ✕ dismiss
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-[11.5px]">
              <div><span className="text-cream-subtle">Attempted</span><div className="font-display text-lg text-cream">{bulkResult.attempted}</div></div>
              <div><span className="text-cream-subtle">{bulkResult.dryRun ? "Would send" : "Sent"}</span><div className="font-display text-lg text-teal-300">{bulkResult.sent}</div></div>
              <div><span className="text-cream-subtle">Skipped</span><div className="font-display text-lg text-amber">{bulkResult.skipped}</div></div>
              <div><span className="text-cream-subtle">Failed</span><div className={`font-display text-lg ${bulkResult.failed > 0 ? "text-red-300" : "text-cream-subtle"}`}>{bulkResult.failed}</div></div>
            </div>

            {/* Sample previews — show generated subject + body so the broker
                can sniff-test tone BEFORE committing to a real send. We
                surface up to 3 (first, middle, last) for tonal variety. */}
            {(bulkResult.sent_rows?.length ?? 0) > 0 && bulkResult.sent_rows!.some(r => r.body) && (
              <details className="pt-1" open={bulkResult.dryRun}>
                <summary className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-300 cursor-pointer hover:text-teal-200">
                  Preview messages ▾ (read 3 samples)
                </summary>
                <div className="mt-2 space-y-3">
                  {pickSamples(bulkResult.sent_rows!).map((r, i) => (
                    <div key={i} className="rounded border border-white/[0.08] bg-steward-base/40 p-3">
                      <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                        → {r.recipientName ?? r.email}
                        {r.recipientName && <span className="text-cream-subtle/60 normal-case"> · {r.email}</span>}
                      </div>
                      <div className="font-heading text-[12.5px] text-cream font-semibold mb-1.5">
                        {r.subject ?? "(no subject)"}
                      </div>
                      <pre className="font-body text-[12px] text-cream-dim leading-relaxed whitespace-pre-wrap">
                        {r.body ?? "(no body)"}
                      </pre>
                      {r.rationale && (
                        <div className="mt-2 pt-2 border-t border-white/[0.05] font-mono text-[10px] text-cream-subtle italic">
                          Anchor: {r.rationale}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {(bulkResult.skipped_rows?.length ?? 0) > 0 && (
              <details className="pt-1">
                <summary className="font-mono text-[10px] text-amber cursor-pointer hover:text-amber/80">
                  {bulkResult.skipped} skipped — see why ▾
                </summary>
                <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto font-mono text-[10.5px] text-cream-dim">
                  {bulkResult.skipped_rows!.map((r, i) => (
                    <li key={i}>{r.email ?? "(no email)"} — {r.reason}</li>
                  ))}
                </ul>
              </details>
            )}
            {(bulkResult.failed_rows?.length ?? 0) > 0 && (
              <details className="pt-1">
                <summary className="font-mono text-[10px] text-red-300 cursor-pointer">
                  {bulkResult.failed} failed ▾
                </summary>
                <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto font-mono text-[10.5px] text-red-300">
                  {bulkResult.failed_rows!.map((r, i) => (
                    <li key={i}>{r.email ?? "(no email)"} — {r.error}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Leads — card list on mobile, table on lg+ */}
        {filtered.length === 0 ? (
          <p className="font-body text-[12px] text-cream-subtle italic py-6 text-center">
            No leads match this filter.
          </p>
        ) : (
          <>
            {/* Mobile: stacked cards. Each lead is its own block with clear
                tap targets — checkbox, name, interest chip, key data, action. */}
            <div className="lg:hidden space-y-2">
              {filtered.map((l) => (
                <LeadCardMobile
                  key={l.id}
                  lead={l}
                  selected={selected.has(l.id)}
                  onToggleSelect={() => toggleOne(l.id)}
                  onCompose={() => setComposeTarget(l)}
                />
              ))}
            </div>

            {/* Desktop: full data table */}
            <div className="hidden lg:block overflow-x-auto -mx-5 px-5">
              <table className="w-full font-body text-[11.5px]">
                <thead>
                <tr className="text-left font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle border-b border-white/[0.05]">
                  <th className="py-2 pr-2 w-6">
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleAll}
                      className="accent-coral-400"
                    />
                  </th>
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">Interest</th>
                  <th className="py-2 pr-3 text-right">Visits</th>
                  <th className="py-2 pr-3">Last activity</th>
                  <th className="py-2 pr-3">Responded?</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className={`border-b border-white/[0.03] ${selected.has(l.id) ? "bg-coral-400/[0.04]" : "hover:bg-white/[0.02]"}`}>
                    <td className="py-2.5 pr-2">
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleOne(l.id)}
                        className="accent-coral-400"
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="font-heading text-[12.5px] text-cream font-semibold truncate max-w-[30ch]">
                        {l.name}
                        {l.signedNda && (
                          <span className="ml-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-coral-300">📝 NDA</span>
                        )}
                      </div>
                      <div className="text-cream-subtle font-mono text-[10px] truncate max-w-[40ch]">
                        {[l.company, l.role].filter(Boolean).join(" · ") || "—"}
                      </div>
                      <div className="text-cream-dim font-mono text-[10.5px] flex items-center gap-3 mt-0.5 truncate">
                        {l.email && <span className="truncate">{l.email}</span>}
                        {l.phone && <span className="text-teal-300">{l.phone}</span>}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`font-mono text-[9px] uppercase tracking-eyebrow border px-1.5 py-0.5 rounded ${INTEREST_TONE[l.interest]}`}>
                        {INTEREST_LABEL[l.interest]}
                      </span>
                      {l.leadScore != null && l.leadScore > 0 && (
                        <div className="font-mono text-[9px] text-cream-subtle mt-1">Score {l.leadScore}</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-cream-dim font-mono">
                      {l.visitCount ?? "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-cream-dim font-mono text-[10.5px]">
                      {fmtRelative(l.lastActivityAt)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <LeadStatusPip lead={l} />
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <button
                        disabled={!l.email}
                        onClick={() => setComposeTarget(l)}
                        title={l.email ? "Compose individual follow-up" : "No email on file"}
                        className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-coral-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Compose →
                      </button>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {/* Individual compose dialog — pre-fills To: email and wires the
          AI-draft button to anchor on this specific lead's engagement */}
      {composeTarget && (
        <SendTouchDialog
          open={!!composeTarget}
          onClose={() => setComposeTarget(null)}
          property={{
            id: propertyId,
            name: propertyName,
            address: null,
            ownerNameRaw: composeTarget.name,
          }}
          leadContext={{
            name: composeTarget.name,
            email: composeTarget.email,
            role: composeTarget.role,
            company: composeTarget.company,
            levelOfInterest: composeTarget.interestRaw,
            visitCount: composeTarget.visitCount,
            lastActivityDate: composeTarget.lastActivityAt,
          }}
        />
      )}
    </div>
  );
}

// Pick up to 3 samples for the preview (first, middle, last). When the set
// has fewer than 3 rows with bodies, returns whatever's available.
function pickSamples<T extends { body?: string }>(rows: T[]): T[] {
  const withBody = rows.filter((r) => !!r.body);
  if (withBody.length <= 3) return withBody;
  return [
    withBody[0],
    withBody[Math.floor(withBody.length / 2)],
    withBody[withBody.length - 1],
  ];
}

// ── Lead status pip ──────────────────────────────────────────────────────
// Visual indicator showing where each lead is in the touch lifecycle:
//   Untouched         — no outbound sent yet
//   Sent Xh ago       — sent within the last 72h, no reply
//   Cold · Xd ago     — sent >72h ago, no reply (needs a follow-up touch)
//   ✓ Replied Xh ago  — they wrote back
function LeadStatusPip({ lead }: { lead: PropertyLead }) {
  const base = "font-mono text-[10px] uppercase tracking-eyebrow border px-1.5 py-0.5 rounded inline-block";

  // Primary status: replied > touched > untouched (per-property)
  let primary: React.ReactNode;
  if (lead.repliedAt) {
    primary = (
      <span className={`${base} border-coral-400/40 bg-coral-400/[0.10] text-coral-300`}>
        ✓ Replied {fmtRelative(lead.repliedAt)}
      </span>
    );
  } else if (lead.lastTouchedAt) {
    const ageHours = (Date.now() - new Date(lead.lastTouchedAt).getTime()) / 3_600_000;
    primary = ageHours > 72 ? (
      <span className={`${base} border-amber/50 bg-amber/[0.10] text-amber`}>
        Cold · {fmtRelative(lead.lastTouchedAt)}
      </span>
    ) : (
      <span className={`${base} border-teal-400/40 bg-teal-400/[0.08] text-teal-300`}>
        ✓ Sent {fmtRelative(lead.lastTouchedAt)}
      </span>
    );
  } else {
    primary = (
      <span className={`${base} border-white/[0.10] bg-white/[0.02] text-cream-subtle`}>
        Untouched
      </span>
    );
  }

  // Cross-property info chip: this person was emailed about ANOTHER listing
  // recently. INFORMATIONAL, not a block — emailing them about THIS property
  // is allowed (they inquired here too) but the AI will vary the angle and
  // language so they don't get a copy/paste of the prior email.
  const cross = lead.crossPropertyTouch ? (
    <span
      className={`${base} border-amber/40 bg-amber/[0.06] text-amber`}
      title={`Emailed about ${lead.crossPropertyTouch.propertyName} on ${new Date(lead.crossPropertyTouch.at).toLocaleString()} — AI will vary the next email accordingly`}
    >
      Also re: {lead.crossPropertyTouch.propertyName} {fmtRelative(lead.crossPropertyTouch.at)}
    </span>
  ) : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {primary}
      {cross}
    </div>
  );
}

// ── Mobile card — replaces the table row on phones ──────────────────────
// Stacks the same information vertically with tap-friendly targets. The
// checkbox is on the left edge and the Compose action is a real button
// (not a tiny text link).

function LeadCardMobile({
  lead: l,
  selected,
  onToggleSelect,
  onCompose,
}: {
  lead: PropertyLead;
  selected: boolean;
  onToggleSelect: () => void;
  onCompose: () => void;
}) {
  return (
    <div
      className={`rounded border px-3 py-3 transition-colors ${
        selected
          ? "border-coral-400/40 bg-coral-400/[0.06]"
          : "border-white/[0.05] bg-white/[0.02]"
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggleSelect}
          aria-label={selected ? "Deselect lead" : "Select lead"}
          className="shrink-0 mt-0.5 w-6 h-6 rounded border border-white/[0.20] flex items-center justify-center accent-coral-400"
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className="accent-coral-400 w-4 h-4 pointer-events-none"
            tabIndex={-1}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <div className="font-heading text-[13.5px] text-cream font-semibold">
              {l.name}
              {l.signedNda && (
                <span className="ml-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-coral-300">📝 NDA</span>
              )}
            </div>
            <span className={`font-mono text-[9px] uppercase tracking-eyebrow border px-1.5 py-0.5 rounded ${INTEREST_TONE[l.interest]}`}>
              {INTEREST_LABEL[l.interest]}
            </span>
          </div>

          {(l.company || l.role) && (
            <div className="text-cream-subtle font-mono text-[10.5px] mt-0.5 truncate">
              {[l.company, l.role].filter(Boolean).join(" · ")}
            </div>
          )}

          {/* Contact rows — wrap so they don't overflow */}
          <div className="mt-1.5 font-mono text-[11px] text-cream-dim space-y-0.5">
            {l.email && (
              <a href={`mailto:${l.email}`} className="block truncate hover:text-coral-300">
                ✉ {l.email}
              </a>
            )}
            {l.phone && (
              <a href={`tel:${l.phone}`} className="block text-teal-300 hover:text-teal-200">
                📞 {l.phone}
              </a>
            )}
          </div>

          <div className="mt-2 flex items-baseline justify-between gap-2 flex-wrap font-mono text-[10px] text-cream-subtle">
            <div className="flex items-center gap-3">
              {l.visitCount != null && l.visitCount > 0 && (
                <span>{l.visitCount} visits</span>
              )}
              {l.lastActivityAt && (
                <span>{fmtRelative(l.lastActivityAt)}</span>
              )}
            </div>
            <LeadStatusPip lead={l} />
          </div>

          <div className="mt-2 pt-2 border-t border-white/[0.04]">
            <button
              disabled={!l.email}
              onClick={onCompose}
              className="w-full px-3 py-2 rounded border border-coral-400/40 bg-coral-400/[0.08] hover:bg-coral-400/[0.18] font-mono text-[10.5px] uppercase tracking-eyebrow text-coral-300 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {l.email ? "Compose follow-up" : "No email on file"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  label, count, active, tone = "default", onClick,
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

function Metric({ label, value, tone = "default" }: { label: string; value: number | null; tone?: "default" | "coral" | "teal" }) {
  const t = tone === "coral" ? "text-coral-300" : tone === "teal" ? "text-teal-300" : "text-cream";
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-1 font-display text-2xl tabular-nums ${t}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "coral" | "teal" | "amber" }) {
  const t = tone === "coral" ? "text-coral-300" : tone === "teal" ? "text-teal-300" : tone === "amber" ? "text-amber" : "text-cream";
  return (
    <div className="rounded border border-white/[0.05] bg-white/[0.02] px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-0.5 font-display text-xl tabular-nums ${t}`}>{value.toLocaleString()}</div>
    </div>
  );
}
