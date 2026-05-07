"use client";

import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * Overview tab — the at-a-glance everything-about-this-asset view. Three
 * primary panels stack on the left (key facts, key contacts, open tasks);
 * leads + linked deals stack on the right.
 */
export function OverviewTab({ p }: { p: PropertyDetail }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Panel eyebrow="Asset facts" num={1} title="Key details">
          <KeyFactsGrid p={p} />
          {p.description && (
            <p className="mt-4 font-body text-[13px] text-cream-dim leading-relaxed">{p.description}</p>
          )}
          {p.notes && (
            <div className="mt-4 pt-4 border-t border-white/[0.04]">
              <Eyebrow tone="muted">Notes</Eyebrow>
              <p className="mt-2 font-body text-[12px] text-cream-dim whitespace-pre-wrap">{p.notes}</p>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Key contacts" num={2} title="People on this asset">
          {p.keyContacts.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">
              No contacts linked yet. Tasks and activities you log against this property will surface their participants here.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {p.keyContacts.map((c) => (
                <div key={c.id} className="border border-white/[0.05] rounded p-3 bg-white/[0.02]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-heading text-[13px] font-semibold text-cream truncate">{c.fullName}</div>
                      {c.email && (
                        <div className="font-mono text-[10px] text-cream-subtle truncate mt-0.5">{c.email}</div>
                      )}
                      {c.phone && (
                        <div className="font-mono text-[10px] text-cream-subtle truncate mt-0.5">{c.phone}</div>
                      )}
                    </div>
                    <StatusBadge tone="neutral" size="xs">{c.role.replace("_", " ")}</StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Open tasks" num={3} title="What's queued">
          {p.tasks.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">No open tasks on this property.</p>
          ) : (
            <div className="space-y-2">
              {p.tasks.map((t) => (
                <div key={t.id} className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-b-0">
                  <input type="checkbox" className="mt-1 accent-coral-400" readOnly />
                  <div className="flex-1 min-w-0">
                    <div className="font-body text-[13px] text-cream">{t.title}</div>
                  </div>
                  <StatusBadge tone={t.tone} size="xs">{t.due}</StatusBadge>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel eyebrow="Inbound" num={4} title={`Leads (${p.leads.length})`}>
          {p.leads.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">No inbound leads referencing this asset.</p>
          ) : (
            <div className="space-y-3">
              {p.leads.slice(0, 6).map((l) => (
                <a
                  key={l.id}
                  href={`/cre-os/inbox/${l.id}`}
                  className="block border border-white/[0.05] rounded p-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-heading text-[12px] font-semibold text-cream truncate">
                      {l.senderName || l.senderEmail || "Unknown sender"}
                    </div>
                    {l.urgency && (
                      <StatusBadge size="xs" tone={l.urgency === "hot" ? "coral" : l.urgency === "warm" ? "amber" : "neutral"}>
                        {l.urgency}
                      </StatusBadge>
                    )}
                  </div>
                  {l.qualifierSummary && (
                    <p className="mt-1 font-body text-[11px] text-cream-dim leading-snug line-clamp-2">
                      {l.qualifierSummary}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Linked deals" num={5} title={`Deals (${p.deals.filter(d => !d.isClosed && !d.isDead).length} open)`}>
          {p.deals.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">No deals tied to this asset yet.</p>
          ) : (
            <div className="space-y-2">
              {p.deals.map((d) => (
                <a
                  key={d.id}
                  href={`/cre-os/pipeline?deal=${d.id}`}
                  className="block border border-white/[0.05] rounded p-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-heading text-[12px] font-semibold text-cream truncate">
                      {d.dealName || "(unnamed deal)"}
                    </div>
                    {d.currentStage && (
                      <StatusBadge size="xs" tone={d.isClosed ? "teal" : d.isDead ? "neutral" : "coral"}>
                        {d.currentStage}
                      </StatusBadge>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-cream-subtle">
                    {d.dealType?.replace("_", " ") ?? "—"}
                    {d.price && <> · {fmtMoney(d.price)}</>}
                    {d.probabilityPct !== null && <> · {Math.round(d.probabilityPct)}%</>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function KeyFactsGrid({ p }: { p: PropertyDetail }) {
  const facts: Array<[string, string | null]> = [
    ["Asset type", p.assetType ? p.assetType.replace("_", " ") : null],
    ["Status", p.status?.replace("_", " ") ?? null],
    ["Pipeline stage", p.pipelineStage],
    ["Your role", p.yourRole?.replace("_", " ") ?? null],
    ["Transaction", p.transactionType?.replace("_", " ") ?? null],
    ["Asking price", p.askingPrice ? fmtMoney(p.askingPrice) : null],
    ["NOI (in-place)", p.noi ? fmtMoney(p.noi) : null],
    ["Cap rate", p.capRate ? `${(p.capRate * 100).toFixed(2)}%` : null],
    ["Total SF", p.sqft ? p.sqft.toLocaleString() : null],
    ["Year built", p.yearBuilt ? p.yearBuilt.toString() : null],
    ["Occupancy", p.occupancyPct !== null ? `${(p.occupancyPct * 100).toFixed(0)}%` : null],
    ["$/SF", p.askingPrice && p.sqft ? "$" + (p.askingPrice / p.sqft).toFixed(2) : null],
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
      {facts.map(([k, v]) => (
        <div key={k}>
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{k}</div>
          <div className="mt-0.5 font-heading text-[14px] text-cream">{v ?? <span className="text-cream-subtle">—</span>}</div>
        </div>
      ))}
    </div>
  );
}
