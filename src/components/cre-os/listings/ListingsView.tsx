"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type {
  ListingsSnapshot,
  ListingCard,
  ListingsAnomaly,
  HotBuyerRow,
} from "@/lib/cre-os/listings-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

const fmtRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

type SideFilter = "all" | "sell" | "buy";

export function ListingsView({ snapshot }: { snapshot: ListingsSnapshot }) {
  const [side, setSide] = useState<SideFilter>("all");

  const filteredCards = useMemo(() => {
    if (side === "all") return snapshot.cards;
    return snapshot.cards.filter((c) => c.side === side);
  }, [snapshot.cards, side]);

  // Right rail
  const rail: RailSection[] = [
    {
      eyebrow: "On market right now",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Sell-side listings" value={snapshot.totals.sellSideCount.toString()} />
          <RailStat label="Buy-side pursuits" value={snapshot.totals.buySideCount.toString()} />
          <RailStat label="Aggregate ask" value={fmtMoney(snapshot.totals.aggregateAsk)} />
          <RailStat label="Reach (7d)" value={snapshot.totals.reach7d.toLocaleString()} />
          <RailStat label="Inquiries (7d)" value={snapshot.totals.inquiries7d.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "Hot buyers across listings",
      children: snapshot.hotBuyers.length === 0 ? (
        <p className="font-body text-[11px] text-cream-subtle italic">
          No hot/warm buyers from CREXi yet. Buyers surface here as they engage your listings.
        </p>
      ) : (
        <div className="space-y-2">
          {snapshot.hotBuyers.slice(0, 6).map((b) => (
            <HotBuyerCard key={b.rowKey} buyer={b} />
          ))}
        </div>
      ),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <a
            href="/cre-os/properties"
            className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
          >
            Add new property →
          </a>
          <a
            href="/cre-os/portals"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            Generate owner update links →
          </a>
          {/* Deep-links to the listing-performance section on the Reports
              page (anchor id="listing-performance"). Lands the broker
              directly on the relevant 7-day rollup table. */}
          <a
            href="/cre-os/reports#listing-performance"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            Listing performance report →
          </a>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        <header>
          <Eyebrow tone="coral">Listings · On market</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Active listings</h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            What's actively on market right now, plus the buy-side pursuits you're tracking. Click any
            card to drill into the property workspace; missing syndication links can be filled in inline.
          </p>
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
            <CommandStat label="Sell-side" value={snapshot.totals.sellSideCount.toString()} caption="Listed + under contract" />
            <CommandStat label="Buy-side" value={snapshot.totals.buySideCount.toString()} caption="Active pursuits" />
            <CommandStat label="Aggregate ask" value={fmtMoney(snapshot.totals.aggregateAsk)} caption="Sell-side total" />
            <CommandStat label="Reach (7d)" value={snapshot.totals.reach7d.toLocaleString()} caption={`${snapshot.totals.inquiries7d} inquiries`} />
          </div>
        </header>

        {/* Anomalies — surface what needs attention before the broker scrolls */}
        {snapshot.anomalies.length > 0 && (
          <section>
            <Eyebrow tone="amber">Needs attention</Eyebrow>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {snapshot.anomalies.map((a) => (
                <AnomalyCard key={a.id} anomaly={a} />
              ))}
            </div>
          </section>
        )}

        {/* Side filter */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mr-1">Side</span>
          <SideChip active={side === "all"} onClick={() => setSide("all")} label={`All · ${snapshot.cards.length}`} />
          <SideChip active={side === "sell"} onClick={() => setSide("sell")} label={`Sell-side · ${snapshot.totals.sellSideCount}`} />
          <SideChip active={side === "buy"} onClick={() => setSide("buy")} label={`Buy-side · ${snapshot.totals.buySideCount}`} />
        </div>

        {/* Card grid */}
        {filteredCards.length === 0 ? (
          <Panel>
            <div className="text-center py-8">
              <p className="font-heading text-[13px] text-cream-dim">
                {snapshot.cards.length === 0
                  ? "No active listings or pursuits yet."
                  : "No cards match this filter."}
              </p>
              <p className="mt-1 font-body text-[11px] text-cream-subtle">
                {snapshot.cards.length === 0
                  ? "Add a property at status \"listed\" or create a buyer-rep deal in the pipeline."
                  : "Switch the side filter or clear it."}
              </p>
            </div>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredCards.map((c) => (
              <ListingCardView key={c.cardId} card={c} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ListingCardView({ card: c }: { card: ListingCard }) {
  const [busyUrlField, setBusyUrlField] = useState<"crexi_url" | "loopnet_url" | null>(null);
  const [crexiUrl, setCrexiUrl] = useState(c.crexiUrl ?? "");
  const [loopnetUrl, setLoopnetUrl] = useState(c.loopnetUrl ?? "");
  const [editing, setEditing] = useState<"crexi" | "loopnet" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const isUC = c.status === "under_contract";
  const muted = c.side === "buy" || isUC;

  async function saveSyndication(field: "crexi_url" | "loopnet_url", value: string) {
    setBusyUrlField(field);
    try {
      const res = await fetch(`/api/properties/${c.propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value.trim() || null }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setEditing(null);
      // Optimistic local update; full refresh on next nav.
    } catch (err: any) {
      alert(`Save failed: ${err.message ?? err}`);
    } finally {
      setBusyUrlField(null);
    }
  }

  function copy(label: string, value: string) {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }

  const subtitle = [c.address, c.city, c.state].filter(Boolean).join(", ");
  const sidePill: { tone: "coral" | "teal" | "neutral"; label: string } =
    c.side === "buy" ? { tone: "teal", label: "Buy-side pursuit" } :
    isUC ? { tone: "neutral", label: "Under contract" } :
    { tone: "coral", label: "Listed" };

  return (
    <article className={`rounded-md border bg-steward-surface/40 overflow-hidden flex flex-col transition-colors ${
      muted ? "border-white/[0.04] opacity-95" : "border-white/[0.06] hover:border-white/[0.12]"
    }`}>
      {/* Hero */}
      <div className="aspect-[16/9] bg-steward-mid/40 relative overflow-hidden">
        {c.heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.heroImageUrl} alt={c.headline || c.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            No photo
          </div>
        )}
        {/* Side / status pill — top-left over hero */}
        <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
          <StatusBadge tone={sidePill.tone} size="xs">{sidePill.label}</StatusBadge>
          {c.assetType && <StatusBadge tone="neutral" size="xs">{c.assetType}</StatusBadge>}
        </div>
      </div>

      {/* Identity */}
      <div className="px-4 pt-3 pb-2 min-h-[60px]">
        {c.slug ? (
          <a
            href={`/cre-os/properties/${c.slug}`}
            className="font-heading text-[14px] text-cream font-semibold hover:text-coral-300 transition-colors line-clamp-2"
          >
            {c.headline || c.name}
          </a>
        ) : (
          <span className="font-heading text-[14px] text-cream-dim font-semibold line-clamp-2">{c.headline || c.name}</span>
        )}
        {subtitle && (
          <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">{subtitle}</div>
        )}
      </div>

      {/* Hard facts row */}
      <div className="px-4 py-2 grid grid-cols-3 gap-2 text-[10.5px] font-mono border-t border-white/[0.04]">
        <Fact label={c.transactionType === "lease" ? "Rate" : "Ask"} value={c.transactionType === "lease" ? (c.leaseRate ? `$${c.leaseRate.toFixed(2)}` : "—") : fmtMoney(c.askingPrice)} accent />
        <Fact label="SF" value={c.sqft ? c.sqft.toLocaleString() : "—"} />
        <Fact label="DOM" value={c.daysOnMarket === null ? "—" : `${c.daysOnMarket}d`} />
      </div>

      {/* Syndication checklist */}
      <div className="px-4 py-2 border-t border-white/[0.04]">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1.5">Syndicated to</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <SyndicationChip
            label="CREXi"
            url={c.crexiUrl}
            editing={editing === "crexi"}
            value={crexiUrl}
            onChange={setCrexiUrl}
            onEdit={() => setEditing(editing === "crexi" ? null : "crexi")}
            onSave={() => saveSyndication("crexi_url", crexiUrl)}
            onCopy={() => c.crexiUrl && copy("crexi", c.crexiUrl)}
            copied={copied === "crexi"}
            busy={busyUrlField === "crexi_url"}
          />
          <SyndicationChip
            label="LoopNet"
            url={c.loopnetUrl}
            editing={editing === "loopnet"}
            value={loopnetUrl}
            onChange={setLoopnetUrl}
            onEdit={() => setEditing(editing === "loopnet" ? null : "loopnet")}
            onSave={() => saveSyndication("loopnet_url", loopnetUrl)}
            onCopy={() => c.loopnetUrl && copy("loopnet", c.loopnetUrl)}
            copied={copied === "loopnet"}
            busy={busyUrlField === "loopnet_url"}
          />
          {/* Site is read-only — driven by publish_to_website + slug */}
          <span
            className={`px-2 py-1 rounded font-heading text-[9px] uppercase tracking-eyebrow font-semibold ${
              c.publishedToSite
                ? "border border-teal-400/30 bg-teal-400/[0.08] text-teal-300"
                : "border border-amber/30 bg-amber/[0.08] text-amber"
            }`}
            title={c.publishedToSite ? "Live on stewardshipcre.com" : "Not yet published to site"}
          >
            Site {c.publishedToSite ? "✓" : "—"}
          </span>
        </div>
      </div>

      {/* 7-day performance */}
      <div className="px-4 py-2 grid grid-cols-4 gap-2 text-[10.5px] font-mono border-t border-white/[0.04]">
        <Fact label="Reach" value={c.reach7d.toLocaleString()} />
        <Fact label="Inq" value={c.inquiries7d.toString()} accent />
        <Fact label="OMs" value={c.omDownloads7d.toString()} />
        <Fact label="NDAs" value={c.ndaSignatures7d.toString()} />
      </div>
      {c.hotBuyerCount > 0 && (
        <div className="px-4 pb-2 -mt-1 font-mono text-[10px] text-coral-300">
          {c.hotBuyerCount} hot/warm buyer{c.hotBuyerCount === 1 ? "" : "s"} circling
        </div>
      )}

      {/* Action row */}
      <div className="mt-auto px-3 py-2 border-t border-white/[0.04] flex items-center gap-1.5 flex-wrap bg-black/10">
        {c.slug && (
          <a
            href={`/cre-os/properties/${c.slug}`}
            className="px-2 py-1 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.12] font-heading text-[9.5px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
          >
            Open
          </a>
        )}
        {c.side === "sell" && (
          <a
            href={`/cre-os/portals?property=${c.propertyId}&audience=owner`}
            className="px-2 py-1 rounded border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.10] font-heading text-[9.5px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
            title="Create an owner-update magic link for this property"
          >
            Owner link
          </a>
        )}
        {c.publishedToSite && c.slug && (
          <a
            href={`https://stewardshipcre.com/properties/${c.slug}`}
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.10] font-heading text-[9.5px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
          >
            Public ↗
          </a>
        )}
        {c.latestSyncAt && (
          <span className="ml-auto font-mono text-[9px] text-cream-subtle">
            Synced {fmtRelative(c.latestSyncAt)}
          </span>
        )}
      </div>
    </article>
  );
}

function SyndicationChip({
  label,
  url,
  editing,
  value,
  onChange,
  onEdit,
  onSave,
  onCopy,
  copied,
  busy,
}: {
  label: string;
  url: string | null;
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCopy: () => void;
  copied: boolean;
  busy: boolean;
}) {
  if (editing) {
    return (
      <div className="flex items-center gap-1 bg-steward-mid/60 border border-coral-400/30 rounded px-1.5 py-0.5">
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`${label} URL`}
          className="bg-transparent border-0 outline-none font-mono text-[10px] text-cream w-[200px] placeholder:text-cream-subtle"
          autoFocus
        />
        <button
          onClick={onSave}
          disabled={busy}
          className="font-heading text-[9px] uppercase tracking-eyebrow text-coral-300 hover:text-coral-200 disabled:opacity-50"
        >
          {busy ? "…" : "Save"}
        </button>
        <button
          onClick={onEdit}
          className="font-heading text-[9px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream"
        >
          ×
        </button>
      </div>
    );
  }
  if (url) {
    return (
      <span className="inline-flex items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="px-2 py-1 rounded border border-teal-400/30 bg-teal-400/[0.08] hover:bg-teal-400/[0.18] font-heading text-[9px] uppercase tracking-eyebrow font-semibold text-teal-300 transition-colors"
          title={url}
        >
          {label} ✓
        </a>
        <button
          onClick={onCopy}
          className="font-mono text-[9px] text-cream-subtle hover:text-cream"
          title={`Copy ${label} URL`}
        >
          {copied ? "copied" : "copy"}
        </button>
      </span>
    );
  }
  return (
    <button
      onClick={onEdit}
      className="px-2 py-1 rounded border border-amber/30 bg-amber/[0.08] hover:bg-amber/[0.18] font-heading text-[9px] uppercase tracking-eyebrow font-semibold text-amber transition-colors"
      title={`Add ${label} URL`}
    >
      {label} +
    </button>
  );
}

function Fact({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-cream-subtle">{label}</div>
      <div className={accent ? "text-coral-300 font-semibold" : "text-cream"}>{value}</div>
    </div>
  );
}

function AnomalyCard({ anomaly: a }: { anomaly: ListingsAnomaly }) {
  const toneClass = {
    coral: "border-coral-400/30 bg-coral-400/[0.06]",
    teal: "border-teal-400/30 bg-teal-400/[0.06]",
    amber: "border-amber/30 bg-amber/[0.06]",
    neutral: "border-white/[0.08] bg-white/[0.03]",
  }[a.tone];
  const headlineClass = {
    coral: "text-coral-300",
    teal: "text-teal-300",
    amber: "text-amber",
    neutral: "text-cream",
  }[a.tone];
  return (
    <a
      href={a.propertySlug ? `/cre-os/properties/${a.propertySlug}` : "#"}
      className={`block rounded border ${toneClass} px-3 py-2.5 hover:bg-white/[0.04] transition-colors`}
    >
      <div className={`font-heading text-[12px] font-semibold ${headlineClass}`}>{a.headline}</div>
      <div className="mt-0.5 font-body text-[11px] text-cream-dim leading-snug">{a.caption}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle truncate">
        {a.propertyName}
      </div>
    </a>
  );
}

function HotBuyerCard({ buyer: b }: { buyer: HotBuyerRow }) {
  const tone = b.level === "Hot" ? "coral" : "teal";
  return (
    <a
      href={b.propertySlug ? `/cre-os/properties/${b.propertySlug}?tab=performance` : "#"}
      className="block rounded border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] px-2.5 py-2 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="font-heading text-[11px] font-semibold text-cream truncate">{b.name}</span>
        <StatusBadge tone={tone} size="xs">{b.level}</StatusBadge>
      </div>
      <div className="font-mono text-[10px] text-cream-subtle truncate">{b.propertyName}</div>
      <div className="font-mono text-[9px] text-cream-subtle mt-0.5">
        {b.visits ? `${b.visits} visits` : ""}
        {b.visits && b.lastActivity ? " · " : ""}
        {b.lastActivity ? fmtRelative(b.lastActivity) : ""}
      </div>
    </a>
  );
}

function CommandStat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="bg-steward-mid/40 border border-white/[0.05] rounded-md p-4">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-display font-medium text-2xl text-cream leading-none">{value}</div>
      {caption && <div className="mt-1 font-mono text-[9px] text-cream-subtle">{caption}</div>}
    </div>
  );
}

function SideChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded font-heading text-[10px] uppercase tracking-eyebrow font-semibold transition-colors ${
        active
          ? "bg-coral-400/[0.15] text-coral-200 ring-1 ring-inset ring-coral-400/30"
          : "bg-white/[0.04] text-cream-dim hover:bg-white/[0.08] hover:text-cream"
      }`}
    >
      {label}
    </button>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold">{value}</span>
    </div>
  );
}
