"use client";

import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { WarmthBadge } from "./WarmthBadge";
import type { RelationshipCard } from "@/lib/cre-os/relationship-queries";

/**
 * RelationshipListCard — compact contact card. Mirrors PropertyListCard's
 * three-layer pattern (lifecycle / hard facts / intelligence) so the
 * inventory + relationships pages feel consistent.
 */
export function RelationshipListCard({ c }: { c: RelationshipCard }) {
  const urgent = c.priorityScore >= 3;
  const warm = c.priorityScore >= 1 && c.priorityScore < 3;
  const cardBorder = urgent
    ? "border-l-2 border-l-coral-400 border-y border-r border-y-white/[0.06] border-r-white/[0.06]"
    : warm
      ? "border-l-2 border-l-amber/60 border-y border-r border-y-white/[0.05] border-r-white/[0.05]"
      : "border border-white/[0.05]";

  return (
    <a
      href={`/cre-os/relationships/${c.id}`}
      className={`block group bg-steward-mid/50 hover:bg-steward-mid/80 rounded-md transition-all ${cardBorder} hover:border-coral-400/30`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="coral">
              {(c.contactType || "Contact").toUpperCase()}
              {c.role && (
                <span className="ml-2 text-cream-subtle">·  {c.role.toUpperCase()}</span>
              )}
            </Eyebrow>
            <h3 className="mt-1 font-display font-medium text-lg text-cream tracking-tight group-hover:text-coral-300 transition-colors leading-snug truncate">
              {c.fullName}
            </h3>
            {c.email && (
              <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">{c.email}</div>
            )}
            {c.phone && !c.email && (
              <div className="mt-0.5 font-mono text-[10px] text-cream-subtle">{c.phone}</div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <WarmthBadge warmth={c.warmth} score={c.warmthScore} manual={!!c.manualWarmth} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2">
          <Stat label="Open deals" value={c.openDealCount.toString()} />
          <Stat label="Hot leads" value={c.hotLeadCount.toString()} />
          <Stat label="Linked props" value={c.linkedPropertyCount.toString()} />
        </div>
      </div>

      {(c.priorityScore > 0 || c.daysSinceTouch !== null) && (
        <div className="px-5 py-3 border-t border-white/[0.04] bg-black/20">
          <div className="flex items-center justify-between gap-3 mb-2">
            <ActivityLine c={c} />
            <Badges c={c} />
          </div>
          {c.nextAction && (
            <div className={`inline-flex items-center gap-1 font-heading text-[10px] font-semibold uppercase tracking-eyebrow ${urgent ? "text-coral-300" : warm ? "text-amber" : "text-cream-dim"}`}>
              → {c.nextAction}
            </div>
          )}
        </div>
      )}
    </a>
  );
}

function ActivityLine({ c }: { c: RelationshipCard }) {
  if (c.daysSinceTouch === null) {
    return <span className="font-mono text-[10px] text-cream-subtle">No activity logged</span>;
  }
  const label =
    c.daysSinceTouch === 0 ? "Touched today"
    : c.daysSinceTouch === 1 ? "Touched yesterday"
    : `Last touched ${c.daysSinceTouch}d ago`;
  return <span className="font-mono text-[10px] text-cream-subtle truncate">{label}</span>;
}

function Badges({ c }: { c: RelationshipCard }) {
  const out: Array<{ label: string; tone: "coral" | "amber" | "neutral" }> = [];
  if (c.hotLeadCount > 0) out.push({ label: `${c.hotLeadCount} hot`, tone: "coral" });
  if (c.followUpOverdue) out.push({ label: "Follow-up due", tone: "coral" });
  if (c.openDealCount > 0) out.push({ label: `${c.openDealCount} deal${c.openDealCount === 1 ? "" : "s"}`, tone: "amber" });
  if (!out.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {out.slice(0, 3).map((b, i) => (
        <StatusBadge key={i} size="xs" tone={b.tone}>{b.label}</StatusBadge>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-[12px] text-cream font-medium">{value}</div>
    </div>
  );
}
