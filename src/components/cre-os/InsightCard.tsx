"use client";

import { StatusBadge } from "./StatusBadge";

/**
 * InsightCard — one row in the right-rail "AI Insights" stream. Each card is
 * a discrete observation the AI generated from system data, with a confidence
 * score, one-line headline, optional caption, and a clickable href to the
 * supporting evidence.
 *
 * Confidence isn't a vibe — it's tied to source records. Tapping the card
 * should land on the property/contact/deal that justifies the score.
 */
export interface InsightItem {
  id: string;
  /** 0-100 — how confident the AI is in the recommendation */
  confidence: number;
  /** One-line headline */
  headline: string;
  /** Brief evidence / context */
  caption?: string;
  /** Navigation target — should land on the supporting record */
  href?: string;
  /** Optional extra label (e.g., "$4.2M", "Lake County") */
  metric?: string;
  /** Tone for the action implied — coral = act, teal = good news, amber = risk */
  tone?: "coral" | "teal" | "amber" | "neutral";
}

export function InsightCard({ item }: { item: InsightItem }) {
  const tone = item.tone ?? "coral";
  const ringClass = {
    coral: "ring-coral-400/30",
    teal: "ring-teal-400/30",
    amber: "ring-amber/30",
    neutral: "ring-white/10",
  }[tone];

  const Wrapper = item.href ? "a" : "div";
  const wrapperProps = item.href ? { href: item.href } : {};

  return (
    <Wrapper
      {...(wrapperProps as any)}
      className={`block p-3 rounded border bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-colors`}
    >
      <div className="flex items-start gap-3">
        {/* Confidence dial — only when there's a real score. Every legacy
            caller hardcodes 100, which turned this into meaningless wallpaper
            ("100" on every card). Until callers pass genuine confidence,
            100 renders as a quiet tone dot instead of a fake number. */}
        {item.confidence < 100 ? (
          <div
            className={`shrink-0 w-9 h-9 rounded-full ring-1 ring-inset ${ringClass} bg-white/[0.02] flex items-center justify-center`}
          >
            <span className="font-mono text-[11px] font-semibold text-cream">
              {Math.round(item.confidence)}
            </span>
          </div>
        ) : (
          <div className={`shrink-0 mt-1.5 w-2 h-2 rounded-full ring-2 ring-inset ${ringClass} ${
            tone === "teal" ? "bg-teal-400/70" : tone === "amber" ? "bg-amber/70" : tone === "neutral" ? "bg-white/30" : "bg-coral-400/70"
          }`} aria-hidden="true" />
        )}

        <div className="flex-1 min-w-0">
          <div className="font-heading text-[12px] font-semibold text-cream leading-snug">
            {item.headline}
          </div>
          {item.caption && (
            <div className="mt-0.5 font-body text-[11px] text-cream-subtle leading-snug">
              {item.caption}
            </div>
          )}
          {item.metric && (
            <div className="mt-1.5">
              <StatusBadge tone={tone} size="xs">
                {item.metric}
              </StatusBadge>
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
}
