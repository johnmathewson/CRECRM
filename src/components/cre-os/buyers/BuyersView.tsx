"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { useContactDrawer } from "@/components/cre-os/ContactDrawer";
import { ContactCallPanel } from "@/components/cre-os/inbox/ContactCallPanel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { InsightItem } from "@/components/cre-os/InsightCard";
import type { BuyerBoard, BuyerRow } from "@/lib/cre-os/buyer-queries";

/**
 * BuyersView — every buyer across every listing, one row per person,
 * ranked by intent. This is the demand side of the off-market machine:
 * who has proven they're in the market, what they've proven it on, and
 * whether we've actually talked to them yet.
 */

type Bucket = "hot" | "untouched" | "multi" | "principals" | "warm" | "all";

export function BuyersView({ board }: { board: BuyerBoard }) {
  const [bucket, setBucket] = useState<Bucket>("hot");
  const [pool, setPool] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [panelLeadId, setPanelLeadId] = useState<string | null>(null);
  const router = useRouter();

  const inBucket = (b: BuyerRow, k: Bucket) => {
    switch (k) {
      case "hot": return b.urgency === "hot";
      case "warm": return b.urgency === "warm";
      case "untouched": return !b.replied && b.callCount === 0 && b.signalTier >= 4 && b.roleClass !== "non_buyer";
      case "multi": return b.listings.length >= 2;
      case "principals": return b.roleClass === "principal" && b.signalTier >= 4;
      default: return true;
    }
  };

  const counts = useMemo(() => ({
    hot: board.buyers.filter((b) => inBucket(b, "hot")).length,
    warm: board.buyers.filter((b) => inBucket(b, "warm")).length,
    untouched: board.buyers.filter((b) => inBucket(b, "untouched")).length,
    multi: board.buyers.filter((b) => inBucket(b, "multi")).length,
    principals: board.buyers.filter((b) => inBucket(b, "principals")).length,
    all: board.buyers.length,
  }), [board.buyers]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return board.buyers.filter((b) => {
      if (!inBucket(b, bucket)) return false;
      if (pool && !b.assetTypes.includes(pool)) return false;
      if (term) {
        const hay = [b.name, b.email, b.phone, b.company, b.role, b.statedCriteria, ...b.listings.map((l) => l.name)]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [board.buyers, bucket, pool, q]);

  const insights: InsightItem[] = [];
  if (counts.untouched > 0) {
    insights.push({
      id: "untouched",
      confidence: 100,
      headline: `${counts.untouched} qualified buyer${counts.untouched === 1 ? "" : "s"} you've never contacted`,
      caption: "Signed a CA or opened the OM, no reply and no call logged. Start here.",
      tone: "coral",
    });
  }
  if (counts.multi > 0) {
    insights.push({
      id: "multi",
      confidence: 100,
      headline: `${counts.multi} touched two or more of your listings`,
      caption: "Active market buyers, not one-off lookers. Best candidates for a buyer-rep agreement.",
      tone: "amber",
    });
  }
  const topPool = board.pools[0];
  if (topPool) {
    insights.push({
      id: "pool",
      confidence: 100,
      headline: `${topPool.caOrBetter} CA-level buyers for ${labelAsset(topPool.assetType)}`,
      caption: "Only one can buy the listing they signed on. The rest are mandates for off-market product.",
      tone: "teal",
    });
  }

  const rail: RailSection[] = [
    { eyebrow: "Where to start", insights },
    {
      eyebrow: "Demand pools",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          {board.pools.map((p) => (
            <button
              key={p.assetType}
              onClick={() => setPool(pool === p.assetType ? null : p.assetType)}
              className={`w-full flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 text-left hover:text-cream transition-colors ${pool === p.assetType ? "text-coral-300" : ""}`}
            >
              <span className="capitalize">{labelAsset(p.assetType)}</span>
              <span className="font-mono">
                <span className="text-cream font-semibold">{p.people}</span>
                <span className="text-cream-subtle"> · {p.caOrBetter} CA · {p.hot} hot</span>
              </span>
            </button>
          ))}
        </div>
      ),
    },
    {
      eyebrow: "How the score works",
      children: (
        <div className="text-[11px] font-body text-cream-dim leading-relaxed space-y-1.5">
          <p><span className="text-coral-300 font-semibold">Signal</span> — offer &gt; CA / OM &gt; saved &gt; flyer &gt; visit.</p>
          <p><span className="text-coral-300 font-semibold">Breadth</span> — each extra listing touched adds weight.</p>
          <p><span className="text-coral-300 font-semibold">Recency + role</span> — active this month and a principal ranks above a listing rep.</p>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        <header>
          <Eyebrow tone="coral">Buyers · Demand side</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Who&apos;s buying</h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            {counts.all} people have shown buy intent across your listings · {counts.hot} hot · {counts.untouched} qualified and never contacted.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle mr-2">Triage</span>
          <Chip label="Hot" count={counts.hot} active={bucket === "hot"} tone="coral" onClick={() => setBucket("hot")} />
          <Chip label="Never contacted" count={counts.untouched} active={bucket === "untouched"} tone="coral" onClick={() => setBucket("untouched")} />
          <Chip label="Multi-listing" count={counts.multi} active={bucket === "multi"} tone="amber" onClick={() => setBucket("multi")} />
          <Chip label="Principals w/ CA" count={counts.principals} active={bucket === "principals"} tone="amber" onClick={() => setBucket("principals")} />
          <div className="h-5 w-px bg-white/[0.08] mx-1" />
          <Chip label="Warm" count={counts.warm} active={bucket === "warm"} tone="neutral" onClick={() => setBucket("warm")} />
          <Chip label="All" count={counts.all} active={bucket === "all"} tone="neutral" onClick={() => setBucket("all")} />
        </div>

        {board.pools.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle mr-2">Pool</span>
            {board.pools.map((p) => (
              <Chip key={p.assetType} label={labelAsset(p.assetType)} count={p.people} active={pool === p.assetType} tone="neutral" onClick={() => setPool(pool === p.assetType ? null : p.assetType)} />
            ))}
          </div>
        )}

        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, company, phone, listing, stated criteria…"
          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-base lg:text-[13px] text-cream placeholder:text-cream-subtle font-body outline-none focus:border-coral-400/40 focus:bg-white/[0.06] transition-colors"
        />

        <div className="space-y-3 pb-8">
          {filtered.length === 0 ? (
            <Panel>
              <p className="font-body text-[13px] text-cream-subtle py-8 text-center">No buyers match this view.</p>
            </Panel>
          ) : (
            filtered.map((b) => (
              <BuyerCard
                key={b.key}
                buyer={b}
                onLogCall={() => setPanelLeadId(b.leadId)}
              />
            ))
          )}
        </div>
      </div>

      <ContactCallPanel
        leadId={panelLeadId}
        onClose={() => { setPanelLeadId(null); router.refresh(); }}
      />
    </AppShell>
  );
}

function BuyerCard({ buyer, onLogCall }: { buyer: BuyerRow; onLogCall: () => void }) {
  const { openLead } = useContactDrawer();
  const router = useRouter();
  const untouched = !buyer.replied && buyer.callCount === 0;
  const isHot = buyer.urgency === "hot";

  const cardClass = isHot
    ? "border-l-2 border-l-coral-400 border-y border-r border-y-coral-400/20 border-r-coral-400/20 bg-coral-400/[0.03]"
    : buyer.urgency === "warm"
      ? "border-l-2 border-l-amber/60 border-y border-r border-y-white/[0.05] border-r-white/[0.05]"
      : "border border-white/[0.05] bg-steward-mid/40";

  return (
    <div className={`rounded-md p-4 ${cardClass}`}>
      {/* Identity row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => openLead(buyer.leadId, { onChange: () => router.refresh() })}
              className="font-display font-medium text-base text-cream hover:text-coral-300 transition-colors truncate text-left"
            >
              {buyer.name}
            </button>
            {buyer.urgency && <StatusBadge size="xs" tone={isHot ? "coral" : buyer.urgency === "warm" ? "amber" : "neutral"}>{buyer.urgency}</StatusBadge>}
            <StatusBadge size="xs" tone={buyer.roleClass === "principal" ? "teal" : buyer.roleClass === "non_buyer" ? "neutral" : "neutral"}>
              {labelRole(buyer.roleClass)}
            </StatusBadge>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">
            {[buyer.company, buyer.role].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-xl font-semibold text-coral-300 leading-none">{buyer.score}</div>
          <div className="font-heading text-[9px] uppercase tracking-eyebrow text-cream-subtle mt-1">score</div>
        </div>
      </div>

      {/* Inferred box */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
        <span className="text-cream">
          {buyer.assetTypes.length ? buyer.assetTypes.map(labelAsset).join(" + ") : "—"}
        </span>
        {buyer.priceMin !== null && (
          <span className="text-cream-dim">
            {buyer.priceMin === buyer.priceMax ? fmtMoney(buyer.priceMin) : `${fmtMoney(buyer.priceMin)}–${fmtMoney(buyer.priceMax!)}`}
          </span>
        )}
        {buyer.topSignal && <span className="text-coral-300">{buyer.topSignal}</span>}
        {buyer.listings.length > 1 && <span className="text-amber">{buyer.listings.length} listings</span>}
        {buyer.totalVisits > 0 && <span className="text-cream-subtle">{buyer.totalVisits} visits</span>}
        <span className="text-cream-subtle">active {buyer.lastActivityRelative}</span>
      </div>

      {buyer.statedCriteria && (
        <p className="mt-2 font-body text-[12px] text-cream leading-snug">
          <span className="text-coral-300 font-semibold">Stated: </span>{buyer.statedCriteria}
        </p>
      )}

      {/* Listings touched */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {buyer.listings.map((l) => (
          l.slug ? (
            <Link key={l.id} href={`/cre-os/properties/${l.slug}`} className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/[0.04] text-cream-dim hover:text-cream hover:bg-white/[0.08] transition-colors">
              {l.name}{l.topSignal ? ` · ${l.topSignal}` : ""}
            </Link>
          ) : (
            <span key={l.id} className="font-mono text-[10px] px-2 py-0.5 rounded bg-white/[0.04] text-cream-dim">
              {l.name}{l.topSignal ? ` · ${l.topSignal}` : ""}
            </span>
          )
        ))}
      </div>

      {/* Contact state + actions — thumb zone */}
      <div className="mt-3 pt-3 border-t border-white/[0.04] flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] mr-auto">
          {untouched
            ? <span className="text-coral-300">Never contacted</span>
            : <span className="text-cream-subtle">
                {buyer.replied && "emailed"}{buyer.replied && buyer.callCount > 0 && " · "}
                {buyer.callCount > 0 && `${buyer.callCount} call${buyer.callCount === 1 ? "" : "s"}${buyer.lastCallOutcome ? ` (${buyer.lastCallOutcome.replace(/_/g, " ")})` : ""}`}
              </span>}
        </span>
        {buyer.phone && (
          <a href={`tel:${buyer.phone.replace(/[^\d+]/g, "")}`} className="px-3 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.20] text-coral-200 font-heading text-[10px] font-semibold uppercase tracking-eyebrow transition-colors">
            Call
          </a>
        )}
        {buyer.phone && (
          <a href={`sms:${buyer.phone.replace(/[^\d+]/g, "")}`} className="px-3 py-1.5 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-cream-dim font-heading text-[10px] font-semibold uppercase tracking-eyebrow transition-colors">
            Text
          </a>
        )}
        {buyer.email && (
          <a href={`mailto:${buyer.email}`} className="px-3 py-1.5 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-cream-dim font-heading text-[10px] font-semibold uppercase tracking-eyebrow transition-colors">
            Email
          </a>
        )}
        <button type="button" onClick={onLogCall} className="px-3 py-1.5 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-cream-dim font-heading text-[10px] font-semibold uppercase tracking-eyebrow transition-colors">
          Log touch
        </button>
        {buyer.contactId && (
          <Link href={`/cre-os/relationships/${buyer.contactId}`} className="px-3 py-1.5 rounded text-cream-subtle hover:text-cream font-heading text-[10px] font-semibold uppercase tracking-eyebrow transition-colors">
            Contact →
          </Link>
        )}
      </div>
    </div>
  );
}

function Chip({ label, count, active, tone, onClick }: {
  label: string; count: number; active: boolean; tone: "coral" | "amber" | "neutral"; onClick: () => void;
}) {
  const dim = count === 0 && !active;
  const baseClass = active
    ? { coral: "border-coral-400 bg-coral-400/[0.15] text-cream", amber: "border-amber bg-amber/[0.15] text-cream", neutral: "border-cream-dim bg-white/[0.10] text-cream" }[tone]
    : dim
      ? "border-white/[0.06] bg-white/[0.01] text-cream-subtle hover:bg-white/[0.04]"
      : { coral: "border-coral-400/30 bg-coral-400/[0.04] text-cream hover:bg-coral-400/[0.08]", amber: "border-amber/30 bg-amber/[0.04] text-cream hover:bg-amber/[0.08]", neutral: "border-white/15 bg-white/[0.02] text-cream-dim hover:bg-white/[0.06]" }[tone];
  const countClass = active
    ? { coral: "text-coral-300", amber: "text-amber", neutral: "text-cream" }[tone]
    : dim ? "text-cream-subtle" : { coral: "text-coral-300", amber: "text-amber", neutral: "text-cream-dim" }[tone];
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-colors ${baseClass}`}>
      <span className="font-heading text-[10px] font-semibold uppercase tracking-eyebrow">{label}</span>
      <span className={`font-mono text-[11px] font-semibold ${countClass}`}>{count}</span>
    </button>
  );
}

function labelAsset(t: string): string {
  const map: Record<string, string> = { retail: "Retail", hospitality: "Hotel", industrial: "Industrial", land: "Land", office: "Office", multifamily: "Multifamily", medical: "Medical", flex: "Flex", mixed_use: "Mixed-use" };
  return map[t] ?? t.replace(/_/g, " ");
}

function labelRole(r: BuyerRow["roleClass"]): string {
  switch (r) {
    case "principal": return "Principal";
    case "buyer_rep": return "Buyer rep";
    case "non_buyer": return "Broker / other";
    case "unknown": return "Role unknown";
    default: return "Other";
  }
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}
