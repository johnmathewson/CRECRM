"use client";

import { Eyebrow } from "@/components/cre-os/Eyebrow";
import type { PropertyAIInsight, PropertyDetail } from "@/lib/cre-os/property-queries";

/**
 * PropertyAISummary — the "brain of the asset" band that sits between the
 * header and the tabbed workspace. Synthesizes one editorial sentence about
 * what's happening with the asset, plus inline insight chips that drill into
 * the supporting evidence.
 *
 * v1: deterministic synthesis from rule-based insights. Phase 2.5 swaps the
 * sentence generator to a Claude Haiku call (cached for the day per property).
 */
export function PropertyAISummary({ p }: { p: PropertyDetail }) {
  const insights = p.insights;
  const sentence = buildSentence(p);

  return (
    <div className="relative overflow-hidden rounded-md border border-coral-400/25 bg-gradient-to-r from-steward-surfaceHi/70 via-steward-mid/50 to-steward-surface/30 backdrop-blur-md mb-6">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-coral-400" />
      <div className="px-5 py-4">
        <Eyebrow tone="coral">Asset summary</Eyebrow>
        <p className="mt-2 font-heading text-[15px] text-cream leading-snug">{sentence}</p>

        {insights.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {insights.map((i) => (
              <InsightChip key={i.id} insight={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function buildSentence(p: PropertyDetail): string {
  const bits: string[] = [];

  // Lead with disposition + headline number
  if (p.status === "listed" && p.askingPrice) {
    bits.push(`Listed at ${formatMoney(p.askingPrice)}.`);
  } else if (p.askingPrice) {
    bits.push(`Carried at ${formatMoney(p.askingPrice)}.`);
  } else if (p.noi) {
    bits.push(`In-place NOI ${formatMoney(p.noi)}.`);
  } else {
    bits.push("Asset profile is incomplete.");
  }

  // Engagement tempo
  const lastTouchDays = p.activity[0]?.rawTime
    ? Math.floor((Date.now() - new Date(p.activity[0].rawTime).getTime()) / 86400000)
    : null;
  if (p.leads.filter((l) => l.urgency === "hot").length > 0) {
    bits.push(`${p.leads.filter((l) => l.urgency === "hot").length} hot inquiries open.`);
  } else if (lastTouchDays === null) {
    bits.push("No recorded activity yet.");
  } else if (lastTouchDays >= 12) {
    bits.push(`${lastTouchDays} days since last touch — owner update overdue.`);
  } else if (lastTouchDays <= 1) {
    bits.push("Active conversation in the last 24 hours.");
  } else {
    bits.push(`Last activity ${lastTouchDays} days ago.`);
  }

  // Forward action
  if (p.deals.find((d) => !d.isClosed && !d.isDead && d.expectedClose && new Date(d.expectedClose) <= new Date(Date.now() + 7 * 86400000))) {
    bits.push("Closing within the week — verify DD checklist.");
  } else if (p.tasks.length > 0) {
    bits.push(`${p.tasks.length} open ${p.tasks.length === 1 ? "task" : "tasks"} on this asset.`);
  }

  return bits.join(" ");
}

function InsightChip({ insight }: { insight: PropertyAIInsight }) {
  const toneClass = {
    coral:   "border-coral-400/40 bg-coral-400/[0.08] text-cream",
    teal:    "border-teal-400/40 bg-teal-400/[0.08] text-cream",
    amber:   "border-amber/40 bg-amber/[0.08] text-cream",
    neutral: "border-white/15 bg-white/[0.04] text-cream-dim",
  }[insight.tone];

  const Wrapper = insight.href ? "a" : "div";
  const wrapperProps = insight.href ? { href: insight.href } : {};

  return (
    <Wrapper
      {...(wrapperProps as any)}
      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded border text-[11px] ${toneClass} ${insight.href ? "hover:brightness-110 transition-all" : ""}`}
    >
      <span className="font-heading font-semibold uppercase tracking-eyebrow text-[10px]">
        {insight.headline}
      </span>
      <span className="font-body text-cream-subtle">·</span>
      <span className="font-body text-[11px] text-cream-dim">{insight.caption}</span>
    </Wrapper>
  );
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + Math.round(n).toLocaleString();
}
