"use client";

import { useEffect, useMemo, useState } from "react";
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

type FilterTab = "all" | "hot" | "engaged" | "awaiting" | "cold";

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

  const filtered = useMemo(() => {
    let out = leads;
    if (filter === "hot") {
      out = out.filter((l) => ["executed_ca", "offer_submitted", "info_request"].includes(l.interest));
    } else if (filter === "engaged") {
      out = out.filter((l) => ["executed_ca", "offer_submitted", "info_request", "downloaded_om"].includes(l.interest));
    } else if (filter === "awaiting") {
      out = out.filter((l) => ["executed_ca", "offer_submitted", "info_request"].includes(l.interest) && !l.respondedAt);
    } else if (filter === "cold") {
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
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <FilterChip label="Hot" tone="coral" active={filter === "hot"} onClick={() => setFilter("hot")} count={totals.hotActions} />
          <FilterChip label="Awaiting response" tone="amber" active={filter === "awaiting"} onClick={() => setFilter("awaiting")} count={totals.awaitingResponse} />
          <FilterChip label="All engaged" active={filter === "engaged"} onClick={() => setFilter("engaged")} />
          <FilterChip label="Cold (viewers only)" active={filter === "cold"} onClick={() => setFilter("cold")} />
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream"
              >
                Clear
              </button>
              <button
                disabled
                title="Coming next: AI-personalized bulk follow-up"
                className="px-4 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.12] font-mono text-[10px] uppercase tracking-eyebrow text-coral-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send AI follow-up ({selectedWithEmail.length})
              </button>
            </div>
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
                      {l.respondedAt ? (
                        <span className="font-mono text-[10px] text-teal-300">✓ {fmtRelative(l.respondedAt)}</span>
                      ) : (
                        <span className="font-mono text-[10px] text-amber">—</span>
                      )}
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

      {/* Individual compose dialog */}
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
        />
      )}
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
              {l.respondedAt ? (
                <span className="text-teal-300">✓ replied</span>
              ) : (
                <span className="text-amber">awaiting</span>
              )}
            </div>
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
