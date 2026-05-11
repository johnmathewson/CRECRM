"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { ProspectorSnapshot, Lane, HotReply } from "@/lib/cre-os/prospector-queries";

const LANE_TONE: Record<string, string> = {
  pre_foreclosure: "text-amber border-amber/30 bg-amber/[0.06]",
  refi_maturity: "text-coral-300 border-coral-400/30 bg-coral-400/[0.06]",
  tired_owner: "text-teal-300 border-teal-400/30 bg-teal-400/[0.06]",
  failed_listing: "text-cream border-white/[0.10] bg-white/[0.04]",
  below_market_rent: "text-cream border-white/[0.10] bg-white/[0.04]",
  probate: "text-cream border-white/[0.10] bg-white/[0.04]",
  custom: "text-cream-dim border-white/[0.08] bg-white/[0.02]",
};

const LANE_LABEL: Record<string, string> = {
  pre_foreclosure: "Pre-foreclosure",
  refi_maturity: "Refi maturity",
  tired_owner: "Tired owner",
  failed_listing: "Failed listing",
  below_market_rent: "Below-market rent",
  probate: "Probate / trust",
  custom: "Custom",
};

const STATUS_TONE: Record<string, string> = {
  active: "text-teal-300",
  paused: "text-cream-subtle",
  draft: "text-amber",
  archived: "text-cream-subtle line-through",
};

export function ProspectorView({ snapshot }: { snapshot: ProspectorSnapshot }) {
  const { totals, lanes, hotReplies } = snapshot;

  const rail: RailSection[] = [
    {
      eyebrow: "Cold inventory",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Total properties" value={totals.coldInventory.toLocaleString()} />
          <RailStat label="In active cadence" value={totals.inActiveCadence.toLocaleString()} />
          <RailStat label="Active lanes" value={totals.activeLanes.toString()} />
          <RailStat label="Touches sent today" value={totals.touchesSentToday.toString()} />
          <RailStat label="Touches sent (7d)" value={totals.touchesSent7d.toString()} />
          <RailStat label="Promoted (30d)" value={totals.promoted30d.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <Link
            href="/cre-os/prospector/inbox"
            className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
          >
            Inbox · Agent stream →
          </Link>
          <Link
            href="/cre-os/settings/data-imports"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            Upload CoStar / PropStream →
          </Link>
          <Link
            href="/cre-os/prospector/inventory"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            Browse cold inventory →
          </Link>
          <Link
            href="/cre-os/prospector/lanes/new"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            New lane →
          </Link>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        <header>
          <Eyebrow tone="coral">Prospector · Cold mining</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">
            The agent's workshop
          </h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            Cold inventory mined from CoStar + PropStream. Lanes pull qualifying properties into
            cadence; engaged owners surface in the Hot replies queue for manual promotion into your
            warm pipeline.
          </p>

          <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CommandStat label="Cold inventory" value={totals.coldInventory.toLocaleString()} caption="status=prospect" />
            <CommandStat label="In cadence" value={totals.inActiveCadence.toLocaleString()} caption={`across ${totals.activeLanes} active lane${totals.activeLanes === 1 ? "" : "s"}`} />
            <CommandStat label="Hot replies" value={totals.hotReplies.toString()} caption="awaiting promotion" />
            <CommandStat label="Touches sent (7d)" value={totals.touchesSent7d.toLocaleString()} caption={`${totals.touchesSentToday} today`} />
          </div>
        </header>

        {totals.coldInventory === 0 && (
          <Panel eyebrow="Get started" num={0} title="No cold inventory yet">
            <div className="font-body text-[13px] text-cream-dim leading-relaxed space-y-3">
              <p>
                Drop your first CoStar export into <Link href="/cre-os/settings/data-imports" className="text-coral-300 underline">Data imports</Link> to seed the cold universe.
                Then layer PropStream weekly to stamp foreclosure, refi-maturity, and tax-delinquency signals onto matched properties.
              </p>
              <p>
                Three default lanes are already configured (Pre-foreclosure, Refi maturity, Tired owner). They'll
                start matching properties as soon as data lands.
              </p>
            </div>
          </Panel>
        )}

        {/* Hot replies — top of fold */}
        <section>
          <Eyebrow tone="amber" num={1}>Hot replies — promote when ready</Eyebrow>
          {hotReplies.length === 0 ? (
            <p className="mt-3 font-body text-[12px] text-cream-subtle italic">
              Nothing engaged yet. When an owner replies, returns a call, or repeatedly opens a portal link,
              they land here for manual review.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {hotReplies.map((r) => (
                <HotReplyRow key={r.enrollmentId} reply={r} />
              ))}
            </div>
          )}
        </section>

        {/* Lanes */}
        <section>
          <Eyebrow tone="coral" num={2}>Lanes</Eyebrow>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
            {lanes.map((l) => (
              <LaneCard key={l.id} lane={l} />
            ))}
            <Link
              href="/cre-os/prospector/lanes/new"
              className="rounded border border-dashed border-white/[0.10] hover:border-coral-400/40 transition-colors flex items-center justify-center px-5 py-8 font-body text-[12px] text-cream-subtle hover:text-coral-300"
            >
              + New lane
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function HotReplyRow({ reply }: { reply: HotReply }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function promote() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/properties/${reply.propertyId}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: `Promoted from ${reply.laneName}` }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Promote failed");
      router.push(`/cre-os/properties`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Promote failed");
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-amber/30 bg-amber/[0.05] px-4 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="font-heading text-[13px] text-cream font-semibold truncate">
          {reply.propertyName}
        </div>
        <div className="font-mono text-[10.5px] text-cream-subtle truncate">
          {reply.propertyAddress ?? "—"} · {reply.laneName}
        </div>
        <div className="font-mono text-[10px] text-amber mt-0.5">{reply.trigger}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/cre-os/prospector/inventory?focus=${reply.propertyId}`}
          className="px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
        >
          Review
        </Link>
        <button
          onClick={promote}
          disabled={busy}
          className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40"
        >
          {busy ? "Promoting…" : "Promote →"}
        </button>
      </div>
    </div>
  );
}

function LaneCard({ lane }: { lane: Lane }) {
  const tone = LANE_TONE[lane.triggerType] ?? LANE_TONE.custom;
  const statusTone = STATUS_TONE[lane.status] ?? "text-cream-subtle";
  return (
    <Link
      href={`/cre-os/prospector/lanes/${lane.id}`}
      className={`block rounded border ${tone} px-4 py-3 hover:scale-[1.005] transition-transform`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] uppercase tracking-eyebrow opacity-80">
            {LANE_LABEL[lane.triggerType] ?? "Custom"}
          </div>
          <div className="font-heading text-[14px] text-cream font-semibold truncate mt-0.5">
            {lane.name}
          </div>
        </div>
        <div className={`font-mono text-[10px] uppercase tracking-eyebrow ${statusTone}`}>
          {lane.status}
        </div>
      </div>
      {lane.description && (
        <p className="mt-2 font-body text-[11.5px] text-cream-dim line-clamp-2">
          {lane.description}
        </p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <MicroStat label="Live" value={lane.liveEnrolled.toString()} />
        <MicroStat label="Touched" value={lane.totalTouched.toString()} />
        <MicroStat label="Replies" value={lane.totalResponded.toString()} />
      </div>
    </Link>
  );
}

function MicroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/[0.03] px-2 py-1.5">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="font-display text-[15px] text-cream tabular-nums">{value}</div>
    </div>
  );
}

function CommandStat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="rounded bg-steward-surface/40 border border-white/[0.05] px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-display font-medium text-2xl text-cream tabular-nums">{value}</div>
      {caption && (
        <div className="mt-0.5 font-mono text-[10px] text-cream-subtle">{caption}</div>
      )}
    </div>
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
