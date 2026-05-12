"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { InsightItem } from "@/components/cre-os/InsightCard";
import { RelationshipListCard } from "./RelationshipListCard";
import { CreateContactDialog } from "./CreateContactDialog";
import type { RelationshipCard, WarmthLabel } from "@/lib/cre-os/relationship-queries";

const CONTACT_TYPES = ["all", "owner", "buyer", "tenant", "lender", "investor", "broker", "vendor", "attorney", "other"];
type Bucket = "all" | "hot" | "owners-quiet" | "follow-ups-due" | "no-recent-touch";

/**
 * RelationshipListView — relationships command surface. Same shape as the
 * properties page (command header / triage strip / today's focus / grid)
 * so the broker's mental model carries across.
 */
export function RelationshipListView({ contacts }: { contacts: RelationshipCard[] }) {
  const [q, setQ] = useState("");
  const [contactType, setContactType] = useState("all");
  const [warmth, setWarmth] = useState<WarmthLabel | "all">("all");
  const [bucket, setBucket] = useState<Bucket>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const counts = useMemo(() => ({
    all: contacts.length,
    hot: contacts.filter((c) => c.warmth === "hot" || c.hotLeadCount > 0).length,
    ownersQuiet: contacts.filter((c) => c.contactType === "owner" && (c.daysSinceTouch === null || c.daysSinceTouch >= 14)).length,
    followUpsDue: contacts.filter((c) => c.followUpOverdue).length,
    noRecentTouch: contacts.filter((c) => c.daysSinceTouch === null || c.daysSinceTouch >= 30).length,
  }), [contacts]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (bucket === "hot" && !(c.warmth === "hot" || c.hotLeadCount > 0)) return false;
      if (bucket === "owners-quiet" && !(c.contactType === "owner" && (c.daysSinceTouch === null || c.daysSinceTouch >= 14))) return false;
      if (bucket === "follow-ups-due" && !c.followUpOverdue) return false;
      if (bucket === "no-recent-touch" && !(c.daysSinceTouch === null || c.daysSinceTouch >= 30)) return false;
      if (warmth !== "all" && c.warmth !== warmth) return false;
      if (contactType !== "all" && c.contactType !== contactType) return false;
      if (term) {
        const hay = [c.fullName, c.email, c.phone, c.contactType, c.role, c.city, c.state]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [contacts, q, contactType, warmth, bucket]);

  const featured = useMemo(
    () => filtered
      .filter((c) => c.priorityScore > 0)
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 4),
    [filtered],
  );
  const featuredIds = new Set(featured.map((f) => f.id));
  const restOfGrid = filtered.filter((c) => !featuredIds.has(c.id));

  // Warmth distribution across full set
  const warmthDist = useMemo(() => {
    const m: Record<WarmthLabel, number> = { hot: 0, warm: 0, cool: 0, cold: 0 };
    for (const c of contacts) m[c.warmth] += 1;
    return m;
  }, [contacts]);

  // AI-interpretive rail
  const insights = buildInsights(contacts, counts);
  const rail: RailSection[] = [
    {
      eyebrow: "Who needs attention",
      insights: insights.length ? insights : [{
        id: "calm",
        confidence: 100,
        headline: "Relationships look calm",
        caption: "No urgent signals across your book today.",
        tone: "teal" as const,
      }],
    },
    {
      eyebrow: "Warmth distribution",
      children: <WarmthDistribution counts={warmthDist} total={contacts.length} />,
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Add contact <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Bulk update warmth <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        {/* Command header */}
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="coral">Relationships · Network intelligence</Eyebrow>
            <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Relationship command surface</h1>
            <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
              {buildSynthesis(contacts, counts, warmthDist)}
            </p>
            <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <CommandStat label="Contacts" value={contacts.length.toString()} caption="In your book" />
              <CommandStat label="Hot relationships" value={warmthDist.hot.toString()} caption={`of ${contacts.length}`} />
              <CommandStat label="Active deals" value={contacts.reduce((s, c) => s + c.openDealCount, 0).toString()} caption="Across all contacts" />
              <CommandStat label="Follow-ups overdue" value={counts.followUpsDue.toString()} caption="Today's outreach" />
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="shrink-0 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
          >
            + Add contact
          </button>
        </header>

        {/* Triage strip */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle mr-2">Triage</span>
          <TriageChip label="Hot" count={counts.hot} active={bucket === "hot"} tone="coral" onClick={() => setBucket(bucket === "hot" ? "all" : "hot")} />
          <TriageChip label="Owners quiet 14d+" count={counts.ownersQuiet} active={bucket === "owners-quiet"} tone="amber" onClick={() => setBucket(bucket === "owners-quiet" ? "all" : "owners-quiet")} />
          <TriageChip label="Follow-ups due" count={counts.followUpsDue} active={bucket === "follow-ups-due"} tone="coral" onClick={() => setBucket(bucket === "follow-ups-due" ? "all" : "follow-ups-due")} />
          <TriageChip label="No recent touch" count={counts.noRecentTouch} active={bucket === "no-recent-touch"} tone="neutral" onClick={() => setBucket(bucket === "no-recent-touch" ? "all" : "no-recent-touch")} />
          <div className="h-5 w-px bg-white/[0.08] mx-1" />
          <TriageChip label="All" count={counts.all} active={bucket === "all"} tone="neutral" onClick={() => setBucket("all")} />
        </div>

        {/* Today's focus */}
        {featured.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <Eyebrow tone="coral" num={1}>Today's focus</Eyebrow>
              <span className="font-mono text-[10px] text-cream-subtle">
                {featured.length} priorit{featured.length === 1 ? "y" : "ies"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-4">
              {featured.map((c) => <RelationshipListCard key={c.id} c={c} />)}
            </div>
          </section>
        )}

        {/* All contacts */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <Eyebrow tone="muted" num={featured.length > 0 ? 2 : 1}>
              {bucket === "all" ? "All contacts" : labelForBucket(bucket)}
            </Eyebrow>
            <span className="font-mono text-[10px] text-cream-subtle">
              {restOfGrid.length}{featured.length > 0 ? ` · plus ${featured.length} featured above` : ""}
            </span>
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[260px]">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, email, phone…"
                className="w-full bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-base lg:text-[13px] text-cream placeholder:text-cream-subtle font-body outline-none focus:border-coral-400/40 focus:bg-white/[0.06] transition-colors"
              />
            </div>
            <FilterSelect label="Type" value={contactType} onChange={setContactType} options={CONTACT_TYPES} />
            <FilterSelect label="Warmth" value={warmth} onChange={(v) => setWarmth(v as WarmthLabel | "all")} options={["all", "hot", "warm", "cool", "cold"]} />
          </div>

          {restOfGrid.length === 0 ? (
            <Panel>
              <p className="font-body text-[13px] text-cream-subtle py-8 text-center">
                {filtered.length === 0
                  ? "No contacts match. Clear filters to see everything."
                  : "Everything in this view is already featured above."}
              </p>
            </Panel>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {restOfGrid.map((c) => <RelationshipListCard key={c.id} c={c} />)}
            </div>
          )}
        </section>
      </div>
      <CreateContactDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function CommandStat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="bg-steward-mid/40 border border-white/[0.05] rounded-md p-4">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-display font-medium text-2xl text-cream leading-none">{value}</div>
      {caption && <div className="mt-1 font-mono text-[9px] text-cream-subtle">{caption}</div>}
    </div>
  );
}

function TriageChip({
  label, count, active, tone, onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: "coral" | "amber" | "neutral";
  onClick: () => void;
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-base lg:text-[12px] text-cream font-body outline-none focus:border-coral-400/40 transition-colors"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-steward-base">
            {o === "all" ? "All" : o.replace("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}

function WarmthDistribution({ counts, total }: { counts: Record<WarmthLabel, number>; total: number }) {
  const rows: Array<{ label: string; value: number; tone: "coral" | "amber" | "teal" | "neutral" }> = [
    { label: "Hot",  value: counts.hot,  tone: "coral" },
    { label: "Warm", value: counts.warm, tone: "amber" },
    { label: "Cool", value: counts.cool, tone: "teal" },
    { label: "Cold", value: counts.cold, tone: "neutral" },
  ];
  const fill = { coral: "bg-coral-400", amber: "bg-amber", teal: "bg-teal-400", neutral: "bg-white/30" };
  return (
    <div className="space-y-2 text-[11px] font-body text-cream-dim">
      {rows.map((r) => {
        const pct = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between mb-0.5">
              <span>{r.label}</span>
              <span className="font-mono text-cream">{r.value} · {pct}%</span>
            </div>
            <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
              <div className={`h-full ${fill[r.tone]}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function buildSynthesis(
  contacts: RelationshipCard[],
  counts: { hot: number; ownersQuiet: number; followUpsDue: number; noRecentTouch: number },
  warmth: Record<WarmthLabel, number>,
): string {
  const total = contacts.length;
  if (total === 0) return "";
  const bits: string[] = [];
  if (counts.hot > 0) bits.push(`${counts.hot} hot`);
  if (counts.followUpsDue > 0) bits.push(`${counts.followUpsDue} follow-up${counts.followUpsDue === 1 ? "" : "s"} due`);
  if (counts.ownersQuiet > 0) bits.push(`${counts.ownersQuiet} owner${counts.ownersQuiet === 1 ? "" : "s"} quiet 14d+`);
  if (warmth.cold > total * 0.6) bits.push("most contacts cold — book needs warming");
  if (bits.length === 0) return `${total} contact${total === 1 ? "" : "s"} in your book. Nothing urgent today.`;
  return `Of ${total} contact${total === 1 ? "" : "s"}, ${bits.join(", ")}.`;
}

function buildInsights(contacts: RelationshipCard[], counts: { hot: number; ownersQuiet: number; followUpsDue: number; noRecentTouch: number }): InsightItem[] {
  const out: InsightItem[] = [];
  const top = [...contacts].sort((a, b) => b.priorityScore - a.priorityScore)[0];
  if (top && top.priorityScore >= 3 && top.nextAction) {
    out.push({
      id: `top-${top.id}`,
      confidence: 100,
      headline: `${top.fullName} — ${top.nextAction}`,
      caption: top.daysSinceTouch !== null ? `Last touched ${top.daysSinceTouch}d ago.` : "Action required.",
      href: `/cre-os/relationships/${top.id}`,
      tone: "coral",
    });
  }
  if (counts.followUpsDue > 0) {
    out.push({
      id: "followups",
      confidence: 100,
      headline: `${counts.followUpsDue} follow-up${counts.followUpsDue === 1 ? "" : "s"} overdue`,
      caption: "Self-set follow-up dates that have passed.",
      tone: "coral",
    });
  }
  if (counts.ownersQuiet > 0) {
    out.push({
      id: "owners-quiet",
      confidence: 100,
      headline: `${counts.ownersQuiet} owner${counts.ownersQuiet === 1 ? "" : "s"} quiet 14+ days`,
      caption: "Premium relationships expect a beat every two weeks.",
      tone: "amber",
    });
  }
  return out.slice(0, 6);
}

function labelForBucket(b: Bucket): string {
  switch (b) {
    case "hot": return "Hot relationships";
    case "owners-quiet": return "Owners — 14+ days quiet";
    case "follow-ups-due": return "Follow-ups overdue";
    case "no-recent-touch": return "No touch in 30+ days";
    default: return "All contacts";
  }
}
