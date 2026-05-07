"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { InsightItem } from "@/components/cre-os/InsightCard";
import { LeadCard } from "./LeadCard";
import type { LeadBucket, LeadCard as LeadCardData } from "@/lib/cre-os/inbox-queries";
import { bucketsForLead } from "@/lib/cre-os/inbox-bucket";

/**
 * InboxView — Lead Command Center.
 *
 * Same shape as the other CRE OS command surfaces (header / triage / focus
 * / list) but tuned for inbox semantics: the triage is *operational*
 * (Needs response / Drafted / Hot / Today / Archived) rather than warmth-
 * based, and the cards are mobile-first because that's where John works
 * leads from.
 */
export function InboxView({ leads }: { leads: LeadCardData[] }) {
  const [bucket, setBucket] = useState<LeadBucket>("needs-response");
  const [q, setQ] = useState("");

  // Pre-compute bucket membership for every lead (runs once per render)
  const leadBuckets = useMemo(
    () => new Map(leads.map((l) => [l.id, new Set(bucketsForLead(l))])),
    [leads],
  );

  const counts = useMemo(() => ({
    all: leads.length,
    needsResponse: leads.filter((l) => leadBuckets.get(l.id)!.has("needs-response")).length,
    drafted: leads.filter((l) => leadBuckets.get(l.id)!.has("drafted")).length,
    hot: leads.filter((l) => leadBuckets.get(l.id)!.has("hot")).length,
    today: leads.filter((l) => leadBuckets.get(l.id)!.has("today")).length,
    archived: leads.filter((l) => leadBuckets.get(l.id)!.has("archived")).length,
    spam: leads.filter((l) => leadBuckets.get(l.id)!.has("spam")).length,
    slaOverdue: leads.filter((l) => l.slaOverdue).length,
  }), [leads, leadBuckets]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (!leadBuckets.get(l.id)!.has(bucket)) return false;
      if (term) {
        const hay = [l.senderDisplay, l.senderEmail, l.rawSubject, l.qualifierSummary, l.bodyPreview, l.propertyLabel, l.property?.name]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [leads, leadBuckets, bucket, q]);

  // Synthesize the morning briefing
  const synthesisLine = (() => {
    const bits: string[] = [];
    if (counts.slaOverdue > 0) bits.push(`${counts.slaOverdue} past the 60-min SLA`);
    if (counts.hot > 0) bits.push(`${counts.hot} hot lead${counts.hot === 1 ? "" : "s"} pending`);
    if (counts.drafted > 0) bits.push(`${counts.drafted} draft${counts.drafted === 1 ? "" : "s"} ready to review`);
    if (counts.today > 0) bits.push(`${counts.today} new today`);
    if (bits.length === 0) return `Inbox is clear. ${counts.all} lead${counts.all === 1 ? "" : "s"} on file.`;
    return bits.join(" · ");
  })();

  // Right rail — interpretive
  const insights: InsightItem[] = (() => {
    const out: InsightItem[] = [];
    if (counts.slaOverdue > 0) {
      out.push({
        id: "sla",
        confidence: 100,
        headline: `${counts.slaOverdue} response${counts.slaOverdue === 1 ? "" : "s"} past 60 min`,
        caption: "The substantive-reply SLA window. Risk drops to near-zero on multi-million-dollar deals when you respond fast.",
        tone: "coral",
      });
    }
    if (counts.hot > 0) {
      out.push({
        id: "hot",
        confidence: 100,
        headline: `${counts.hot} hot lead${counts.hot === 1 ? "" : "s"} pending`,
        caption: "AI-flagged high-intent inbound. Tap into Hot bucket to triage.",
        tone: "coral",
      });
    }
    if (counts.drafted > 0) {
      out.push({
        id: "drafted",
        confidence: 100,
        headline: `${counts.drafted} draft${counts.drafted === 1 ? "" : "s"} waiting for your review`,
        caption: "Tap to read, edit, send.",
        tone: "amber",
      });
    }
    if (out.length === 0) {
      out.push({
        id: "calm",
        confidence: 100,
        headline: "Inbox is clear",
        caption: "Nothing past SLA. Nothing pending review. Good day to source.",
        tone: "teal",
      });
    }
    return out;
  })();

  const rail: RailSection[] = [
    { eyebrow: "What needs attention", insights },
    {
      eyebrow: "Inbox at a glance",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Total in inbox" value={counts.all.toString()} />
          <RailStat label="Hot" value={counts.hot.toString()} />
          <RailStat label="Needs response" value={counts.needsResponse.toString()} />
          <RailStat label="Drafted" value={counts.drafted.toString()} />
          <RailStat label="Arrived today" value={counts.today.toString()} />
          <RailStat label="Past SLA" value={counts.slaOverdue.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "SLA",
      children: (
        <div className="text-[11px] font-body text-cream-dim leading-relaxed">
          <p>
            <span className="text-coral-300 font-semibold">&lt;60s:</span> auto-receipt fires automatically.
          </p>
          <p className="mt-2">
            <span className="text-coral-300 font-semibold">&lt;60min:</span> AI-drafted substantive reply, OM attached. You tap to send.
          </p>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        {/* Header */}
        <header>
          <Eyebrow tone="coral">Inbox · Lead Command</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Lead command center</h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            {synthesisLine}
          </p>
        </header>

        {/* Triage strip */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle mr-2">Triage</span>
          <TriageChip label="Needs response" count={counts.needsResponse} active={bucket === "needs-response"} tone="coral" onClick={() => setBucket("needs-response")} />
          <TriageChip label="Drafted" count={counts.drafted} active={bucket === "drafted"} tone="amber" onClick={() => setBucket("drafted")} />
          <TriageChip label="Hot" count={counts.hot} active={bucket === "hot"} tone="coral" onClick={() => setBucket("hot")} />
          <TriageChip label="Today" count={counts.today} active={bucket === "today"} tone="neutral" onClick={() => setBucket("today")} />
          <div className="h-5 w-px bg-white/[0.08] mx-1" />
          <TriageChip label="All" count={counts.all} active={bucket === "all"} tone="neutral" onClick={() => setBucket("all")} />
          <TriageChip label="Archived" count={counts.archived} active={bucket === "archived"} tone="neutral" onClick={() => setBucket("archived")} />
          <TriageChip label="Spam" count={counts.spam} active={bucket === "spam"} tone="neutral" onClick={() => setBucket("spam")} />
        </div>

        {/* Search */}
        <div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sender, subject, message, property…"
            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-[13px] text-cream placeholder:text-cream-subtle font-body outline-none focus:border-coral-400/40 focus:bg-white/[0.06] transition-colors"
          />
        </div>

        {/* List */}
        <div className="space-y-3 pb-8">
          {filtered.length === 0 ? (
            <Panel>
              <p className="font-body text-[13px] text-cream-subtle py-8 text-center">
                {labelForEmpty(bucket)}
              </p>
            </Panel>
          ) : (
            filtered.map((l) => <LeadCard key={l.id} lead={l} />)
          )}
        </div>
      </div>
    </AppShell>
  );
}

function TriageChip({
  label, count, active, tone, onClick,
}: {
  label: string; count: number; active: boolean;
  tone: "coral" | "amber" | "neutral"; onClick: () => void;
}) {
  const dim = count === 0 && !active;
  const baseClass = active
    ? {
        coral:   "border-coral-400 bg-coral-400/[0.15] text-cream",
        amber:   "border-amber bg-amber/[0.15] text-cream",
        neutral: "border-cream-dim bg-white/[0.10] text-cream",
      }[tone]
    : dim
      ? "border-white/[0.06] bg-white/[0.01] text-cream-subtle hover:bg-white/[0.04]"
      : {
          coral:   "border-coral-400/30 bg-coral-400/[0.04] text-cream hover:bg-coral-400/[0.08]",
          amber:   "border-amber/30 bg-amber/[0.04] text-cream hover:bg-amber/[0.08]",
          neutral: "border-white/15 bg-white/[0.02] text-cream-dim hover:bg-white/[0.06]",
        }[tone];
  const countClass = active
    ? { coral: "text-coral-300", amber: "text-amber", neutral: "text-cream" }[tone]
    : dim
      ? "text-cream-subtle"
      : { coral: "text-coral-300", amber: "text-amber", neutral: "text-cream-dim" }[tone];
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-colors ${baseClass}`}>
      <span className="font-heading text-[10px] font-semibold uppercase tracking-eyebrow">{label}</span>
      <span className={`font-mono text-[11px] font-semibold ${countClass}`}>{count}</span>
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

function labelForEmpty(b: LeadBucket): string {
  switch (b) {
    case "needs-response": return "No leads waiting for response. SLA timer is at zero.";
    case "drafted": return "No drafts ready to review. Drafts will land here once the AI drafter writes them.";
    case "hot": return "No hot leads pending.";
    case "today": return "No leads have arrived today yet.";
    case "archived": return "Archive is empty.";
    case "spam": return "No spam flagged.";
    default: return "Inbox is empty.";
  }
}
