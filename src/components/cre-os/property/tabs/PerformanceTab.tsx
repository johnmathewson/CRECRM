"use client";

import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";
import type { ListingPerformance, FunnelStage, SourcePerformance, NamedBuyer, PerformanceAnomaly } from "@/lib/cre-os/listing-perf-queries";

/**
 * PerformanceTab — listing engagement intelligence (Phase 6).
 *
 * Reads listing_metrics + crexi_leads_state for the property. Renders:
 *   • Funnel viz (impressions → views → inquiries → OM opens → CAs → offers)
 *   • Source platform comparison (CREXi vs LoopNet side-by-side)
 *   • Named buyer engagement leaderboard
 *   • Synthesized anomaly callouts
 *
 * Honest empty state when listing_metrics has no rows for this property.
 */
export function PerformanceTab({ p, perf }: { p: PropertyDetail; perf: ListingPerformance }) {
  if (!perf.hasData) {
    return (
      <Panel eyebrow="Listing performance" num={1} title="No engagement data yet">
        <p className="font-body text-[13px] text-cream-dim leading-relaxed py-3 max-w-2xl">
          Once this property is syndicated to CREXi or LoopNet, the Chrome extension's sync feeds the
          impressions → views → inquiries → OM opens → CAs → offers funnel into <code className="font-mono text-cream-subtle">listing_metrics</code>,
          and per-buyer engagement into <code className="font-mono text-cream-subtle">crexi_leads_state</code>. Both will render here automatically.
        </p>
        <div className="mt-4 flex gap-2 flex-wrap">
          <a
            href="/properties"
            className="inline-flex items-center gap-2 px-3 py-2 rounded border border-coral-400/40 bg-coral-400/[0.06] text-coral-300 hover:bg-coral-400/[0.10] font-heading text-[11px] font-semibold uppercase tracking-eyebrow transition-colors"
          >
            Open legacy listing manager
          </a>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      {/* Synthesized anomaly callouts at the top — the "what should I notice" header */}
      {perf.anomalies.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {perf.anomalies.map((a) => <AnomalyCard key={a.id} anomaly={a} />)}
        </div>
      )}

      {/* Funnel — the big-picture story */}
      <Panel
        eyebrow="Funnel"
        num={1}
        title={`${perf.latestPeriodStart} → ${perf.latestPeriodEnd}`}
        actions={
          perf.prior && (
            <span className="font-mono text-[10px] text-cream-subtle">
              vs prior week: {perf.prior.impressions.toLocaleString()} imp · {perf.prior.inquiries} inq
            </span>
          )
        }
      >
        <FunnelChart stages={perf.funnel} prior={perf.prior} />
      </Panel>

      {/* Source breakdown */}
      {perf.sources.length > 0 && (
        <Panel eyebrow="Sources" num={2} title="Platform comparison">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {perf.sources.map((s) => <SourceCard key={s.source} source={s} />)}
          </div>
        </Panel>
      )}

      {/* Named buyers */}
      {perf.namedBuyers.length > 0 && (
        <Panel
          eyebrow="Engaged buyers"
          num={3}
          title={`${perf.namedBuyers.length} tracked from CREXi`}
          actions={<span className="font-mono text-[10px] text-cream-subtle">level_of_interest + visit count</span>}
        >
          <NamedBuyerTable buyers={perf.namedBuyers} />
        </Panel>
      )}
    </div>
  );
}

// ── Funnel visualization ──────────────────────────────────────────────────
function FunnelChart({ stages, prior }: { stages: FunnelStage[]; prior: ListingPerformance["prior"] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const widthPct = (s.value / max) * 100;
        const dim = s.value === 0;
        const priorVal = prior ? (prior as any)[stageToPriorKey(s.key)] : null;
        const trendPct = priorVal && priorVal > 0 ? ((s.value - priorVal) / priorVal) * 100 : null;
        return (
          <div key={s.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-[11px] font-body">
              <span className={`uppercase tracking-eyebrow font-heading font-semibold ${dim ? "text-cream-subtle" : "text-cream"}`}>
                {String(i + 1).padStart(2, "0")} · {s.label}
              </span>
              <div className="flex items-baseline gap-3">
                {s.conversionFromPrior !== null && (
                  <span className="font-mono text-cream-subtle">
                    {(s.conversionFromPrior * 100).toFixed(1)}% conv.
                  </span>
                )}
                {trendPct !== null && (
                  <span className={`font-mono ${trendPct >= 0 ? "text-teal-300" : "text-coral-300"}`}>
                    {trendPct > 0 ? "+" : ""}{trendPct.toFixed(0)}%
                  </span>
                )}
                <span className={`font-display font-medium text-base ${dim ? "text-cream-subtle" : "text-cream"}`}>
                  {s.value.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="h-3 bg-white/[0.03] rounded overflow-hidden">
              <div
                className={`h-full ${dim ? "bg-white/[0.06]" : "bg-gradient-to-r from-coral-400/60 to-coral-400/30"} transition-all`}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function stageToPriorKey(key: FunnelStage["key"]): string {
  switch (key) {
    case "impressions": return "impressions";
    case "page_views": return "pageViews";
    case "inquiries": return "inquiries";
    case "opened_oms": return "openedOms";
    default: return "_none";
  }
}

// ── Source card ───────────────────────────────────────────────────────────
function SourceCard({ source }: { source: SourcePerformance }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-md p-4">
      <div className="flex items-baseline justify-between mb-3">
        <Eyebrow tone="coral">{source.source.toUpperCase()}</Eyebrow>
        {source.conversionPct !== null && (
          <span className="font-mono text-[11px] text-cream-dim">
            {source.conversionPct.toFixed(2)}% inq/imp
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        <SourceStat label="Impressions" value={source.impressions} accent />
        <SourceStat label="Page views" value={source.pageViews} />
        <SourceStat label="Unique visitors" value={source.uniqueVisitors} />
        <SourceStat label="Inquiries" value={source.inquiries} accent />
        <SourceStat label="OM opens" value={source.openedOms} />
        <SourceStat label="CAs / NDAs" value={source.executedCas} />
        <SourceStat label="Offers" value={source.offers} />
      </div>
    </div>
  );
}

function SourceStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`font-display font-medium text-lg ${accent ? "text-coral-300" : "text-cream"}`}>{value.toLocaleString()}</div>
    </div>
  );
}

// ── Named buyer table ─────────────────────────────────────────────────────
function NamedBuyerTable({ buyers }: { buyers: NamedBuyer[] }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12px] font-body">
        <thead>
          <tr className="text-cream-subtle text-left">
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-2 px-2">Name</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-2 px-2">Company</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-2 px-2">Interest</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-2 px-2 text-right">Visits</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-2 px-2">Last activity</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold pb-2 px-2">In CRM</th>
          </tr>
        </thead>
        <tbody>
          {buyers.slice(0, 30).map((b) => (
            <tr key={b.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
              <td className="px-2 py-2">
                <div className="font-heading text-cream font-medium truncate">{b.name ?? "(unnamed)"}</div>
                {b.email && <div className="font-mono text-[10px] text-cream-subtle truncate">{b.email}</div>}
              </td>
              <td className="px-2 py-2 text-cream-dim truncate">
                {b.company ?? "—"}
                {b.role && <div className="font-mono text-[10px] text-cream-subtle truncate">{b.role}</div>}
              </td>
              <td className="px-2 py-2">
                {b.levelOfInterest ? (
                  <StatusBadge size="xs" tone={toneForInterest(b.levelOfInterest)}>{b.levelOfInterest}</StatusBadge>
                ) : (
                  <span className="text-cream-subtle">—</span>
                )}
              </td>
              <td className="px-2 py-2 text-right font-mono text-cream-dim">{b.numberOfVisits ?? 0}</td>
              <td className="px-2 py-2 font-mono text-[10px] text-cream-subtle">{b.lastActivityWhen}</td>
              <td className="px-2 py-2">
                {b.contactId ? (
                  <a href={`/cre-os/relationships/${b.contactId}`} className="font-mono text-[10px] text-teal-300 hover:underline">View →</a>
                ) : (
                  <span className="font-mono text-[10px] text-cream-subtle">Not yet</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {buyers.length > 30 && (
        <p className="mt-3 font-mono text-[10px] text-cream-subtle text-center">
          + {buyers.length - 30} more — full list lands when we add a paginated view
        </p>
      )}
    </div>
  );
}

function toneForInterest(level: string | null): "coral" | "amber" | "teal" | "neutral" {
  if (!level) return "neutral";
  const v = level.toLowerCase();
  if (v.includes("hot")) return "coral";
  if (v.includes("warm")) return "amber";
  if (v.includes("cold")) return "neutral";
  if (v.includes("interest")) return "teal";
  return "neutral";
}

// ── Anomaly card ──────────────────────────────────────────────────────────
function AnomalyCard({ anomaly }: { anomaly: PerformanceAnomaly }) {
  const accent = {
    coral: "border-l-coral-400 bg-coral-400/[0.05]",
    amber: "border-l-amber bg-amber/[0.05]",
    teal: "border-l-teal-400 bg-teal-400/[0.05]",
    neutral: "border-l-white/30 bg-white/[0.02]",
  }[anomaly.tone];
  return (
    <div className={`p-4 rounded border-l-2 border border-white/[0.05] ${accent}`}>
      <div className="font-heading text-[13px] font-semibold text-cream leading-snug">{anomaly.headline}</div>
      <p className="mt-1 font-body text-[12px] text-cream-dim leading-snug">{anomaly.caption}</p>
    </div>
  );
}
