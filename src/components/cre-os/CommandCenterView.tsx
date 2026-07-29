"use client";

import Link from "next/link";
import { AppShell } from "@/components/cre-os/AppShell";
import { CopilotRibbon, CopilotChip } from "@/components/cre-os/CopilotRibbon";
import { KpiTile } from "@/components/cre-os/KpiTile";
import { Sparkline } from "@/components/cre-os/Sparkline";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { DoThisNow } from "@/components/cre-os/DoThisNow";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { DashboardData } from "@/lib/cre-os/queries";
import type { LeadCard as LeadCardData } from "@/lib/cre-os/inbox-queries";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

export function CommandCenterView({
  data,
  doThisNow = [],
}: {
  data: DashboardData;
  doThisNow?: LeadCardData[];
}) {
  const { kpis, pipeline, chips, tasks, activity, reminders, copilot, agentBrief } = data;

  // Build the Copilot focus chips from real counts
  const copilotChips: CopilotChip[] = [
    { label: "Hot leads",        count: chips.hotLeads,      tone: chips.hotLeads > 0 ? "coral" : "neutral",   href: "/cre-os/stream",                  caption: chips.hotLeads ? "Need response" : "All clear" },
    { label: "Underwriting",     count: chips.underwriting,  tone: chips.underwriting > 0 ? "amber" : "neutral", href: "/cre-os/pipeline?stage=Underwriting",       caption: "DD review" },
    { label: "Owner check-ins",  count: chips.ownerCheckIns, tone: chips.ownerCheckIns > 0 ? "neutral" : "neutral", href: "/cre-os/relationships?bucket=owners",  caption: "Update due" },
    { label: "Closing soon",     count: chips.closingSoon,   tone: chips.closingSoon > 0 ? "teal" : "neutral",  href: "/cre-os/pipeline?stage=Closing",            caption: "Within 7 days" },
    { label: "Tasks today",      count: kpis.tasksDueToday + kpis.tasksOverdue, tone: kpis.tasksOverdue > 0 ? "coral" : (kpis.tasksDueToday > 0 ? "amber" : "neutral"), href: "/cre-os?focus=tasks", caption: kpis.tasksOverdue ? `${kpis.tasksOverdue} overdue` : "Due today" },
  ];

  const rail: RailSection[] = [
    {
      eyebrow: "Automated reminders",
      insights: reminders.length
        ? reminders.map((r) => ({ id: r.id, confidence: 100, headline: r.headline, caption: r.caption, href: r.href, tone: r.tone }))
        : [{
            id: "no-reminders",
            confidence: 100,
            headline: "No active reminders",
            caption: "Lease rollover, debt maturity, and reporting reminders will surface here as data lands.",
            tone: "neutral" as const,
          }],
    },
    {
      eyebrow: "Pipeline at a glance",
      children: <PipelineCondensed pipeline={pipeline} />,
    },
    {
      eyebrow: "Next best actions",
      insights: [
        ...(chips.hotLeads > 0 ? [{
          id: "nba-leads",
          confidence: 0,
          headline: `Follow up with ${chips.hotLeads} hot lead${chips.hotLeads === 1 ? "" : "s"}`,
          caption: "Inbound inquiries flagged hot by the AI extractor",
          href: "/cre-os/stream",
          tone: "coral" as const,
        }] : []),
        ...(kpis.tasksOverdue > 0 ? [{
          id: "nba-overdue",
          confidence: 0,
          headline: `Resolve ${kpis.tasksOverdue} overdue task${kpis.tasksOverdue === 1 ? "" : "s"}`,
          caption: "Past-due commitments — biggest credibility risk",
          href: "/cre-os?focus=tasks",
          tone: "coral" as const,
        }] : []),
        ...(chips.closingSoon > 0 ? [{
          id: "nba-closing",
          confidence: 0,
          headline: `${chips.closingSoon} deal${chips.closingSoon === 1 ? "" : "s"} closing this week`,
          caption: "Confirm DD checklist, lender, signatures",
          href: "/cre-os/pipeline?stage=Closing",
          tone: "teal" as const,
        }] : []),
      ].slice(0, 5),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        {/* Agent Brief — Prospector's overnight summary. Top-of-page so
            the broker sees "what does my agent want me to do today" before
            anything else. */}
        <AgentBriefPanel brief={agentBrief} />

        {/* Greeting + Copilot ribbon */}
        <CopilotRibbon
          greeting={copilot.greeting}
          summary={copilot.summary}
          chips={copilotChips}
        />

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiTile
            label="Pipeline value"
            value={fmtMoney(kpis.pipelineValue)}
            caption={kpis.pipelineValue > 0 ? "Open deals" : "No open deals"}
          />
          <KpiTile
            label="NOI (in-place)"
            value={fmtMoney(kpis.noi)}
            caption={kpis.noi > 0 ? "Sum across active assets" : "Add NOI to properties"}
          />
          <KpiTile
            label="Active listings"
            value={kpis.activeListings.toString()}
            caption="Listed or active"
          />
          <KpiTile
            label="Hot leads"
            value={kpis.hotLeads.toString()}
            caption={kpis.hotLeads > 0 ? "Need follow-up" : "All clear"}
          />
          <KpiTile
            label="Cap rate (avg)"
            value={kpis.capRateAvg ? (kpis.capRateAvg * 100).toFixed(1) + "%" : "—"}
            caption="$-weighted across portfolio"
          />
          <KpiTile
            label="Tasks due today"
            value={kpis.tasksDueToday.toString()}
            delta={kpis.tasksOverdue > 0 ? `${kpis.tasksOverdue} overdue` : undefined}
            deltaTone="down"
            caption={kpis.tasksOverdue > 0 ? undefined : "On track"}
          />
        </div>

        {/* Do This Now — ranked action queue. Each row opens the
            ContactDrawer in-context (no navigation). */}
        <DoThisNow leads={doThisNow} />

        {/* Pipeline preview */}
        <Panel
          eyebrow="Pipeline"
          num={1}
          title="Stage health"
          actions={
            <a href="/cre-os/pipeline" className="font-heading text-[11px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">
              View all →
            </a>
          }
        >
          <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-11 gap-2">
            {pipeline.map((s) => (
              <div key={s.stage} className="bg-white/[0.02] border border-white/[0.04] rounded p-3">
                <Eyebrow tone={s.count > 0 ? "coral" : "muted"}>{s.stage}</Eyebrow>
                <div className="mt-2 font-display font-medium text-2xl text-cream leading-none">{s.count}</div>
                <div className="mt-1 font-mono text-[10px] text-cream-subtle">{s.value > 0 ? fmtMoney(s.value) : "—"}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Tasks + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Panel
            eyebrow="Today"
            num={2}
            title="Tasks & follow-ups"
            actions={<a href="/cre-os?focus=tasks" className="font-heading text-[11px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">All tasks →</a>}
          >
            {tasks.length === 0 ? (
              <p className="font-body text-[13px] text-cream-subtle py-6 text-center">No open tasks.</p>
            ) : (
              <div className="space-y-2">
                {tasks.map((t) => (
                  <a
                    key={t.id}
                    href={t.href}
                    className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] -mx-2 px-2 rounded transition-colors"
                  >
                    <input type="checkbox" className="mt-1 accent-coral-400 pointer-events-none" readOnly />
                    <div className="flex-1 min-w-0">
                      <div className="font-body text-[13px] text-cream truncate">{t.title}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">{t.context}</div>
                    </div>
                    <StatusBadge tone={t.tone} size="xs">{t.due}</StatusBadge>
                  </a>
                ))}
              </div>
            )}
          </Panel>

          <Panel eyebrow="Recent activity" num={3} title="What changed">
            {activity.length === 0 ? (
              <p className="font-body text-[13px] text-cream-subtle py-6 text-center">
                Nothing logged yet. Activity will appear here as you work.
              </p>
            ) : (
              <div className="space-y-3 text-[13px] font-body text-cream-dim">
                {activity.map((a) => (
                  <div key={a.id} className="flex items-baseline gap-3">
                    <span className="font-mono text-[10px] text-cream-subtle w-16 shrink-0">{a.when}</span>
                    <span className="text-cream font-medium">{a.who}</span>
                    <span>{a.did}</span>
                    <span className="text-coral-300 truncate">{a.target}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Footer phase indicator */}
        <div className="pt-4 border-t border-white/[0.04] flex items-center justify-between text-[10px] font-mono text-cream-subtle">
          <span>CRE OS · Phase 1.5 (data wired) · {new Date().toISOString().slice(0,10)}</span>
          <span>Live data · refresh page to update</span>
        </div>
      </div>
    </AppShell>
  );
}

function PipelineCondensed({ pipeline }: { pipeline: DashboardData["pipeline"] }) {
  const top = pipeline.filter((p) => p.count > 0).slice(0, 5);
  if (top.length === 0) {
    return <p className="font-body text-[11px] text-cream-subtle">No active deals yet.</p>;
  }
  const maxCount = Math.max(...top.map((p) => p.count), 1);
  return (
    <div className="space-y-1.5">
      {top.map((p) => (
        <div key={p.stage} className="text-[11px] font-body text-cream-dim">
          <div className="flex items-baseline justify-between mb-0.5">
            <span className="truncate">{p.stage}</span>
            <span className="font-mono text-cream-subtle">{p.count} · {fmtMoney(p.value)}</span>
          </div>
          <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="h-full bg-coral-400/60"
              style={{ width: `${(p.count / maxCount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Agent Brief panel ────────────────────────────────────────────────────
// The Prospector agent's "stand-up report" — what it did since yesterday,
// what's waiting on the broker. Top action surfaces the highest-priority
// thing to handle right now.
function AgentBriefPanel({ brief }: { brief: DashboardData["agentBrief"] }) {
  const toneClass = {
    coral: "border-coral-400/40 bg-coral-400/[0.08] text-coral-300",
    amber: "border-amber/40 bg-amber/[0.08] text-amber",
    teal: "border-teal-400/40 bg-teal-400/[0.08] text-teal-300",
  };
  return (
    <div className="rounded-lg border border-white/[0.08] bg-gradient-to-br from-steward-surface/40 to-steward-base/40 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
            Prospector · Agent brief
          </span>
          <Link
            href="/cre-os/prospector"
            className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle hover:text-coral-300"
          >
            → Open Prospector
          </Link>
        </div>
        {brief.topAction && (
          <Link
            href={brief.topAction.href}
            className={`px-3 py-1.5 rounded border font-mono text-[10px] uppercase tracking-eyebrow ${toneClass[brief.topAction.tone]}`}
          >
            {brief.topAction.label} →
          </Link>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <BriefStat label="Sent today" value={brief.sentToday} />
        <BriefStat label="Sent 7d" value={brief.sent7d} />
        <BriefStat label="Replies (unread)" value={brief.repliesUnread} tone={brief.repliesUnread > 0 ? "coral" : "default"} />
        <BriefStat label="Cold >72h" value={brief.awaitingReplyOver72h} tone={brief.awaitingReplyOver72h > 0 ? "amber" : "default"} />
        <BriefStat label="Drafts queued" value={brief.draftsQueued} tone={brief.draftsQueued > 0 ? "teal" : "default"} />
      </div>
      {(brief.intents.interested + brief.intents.question + brief.intents.declined + brief.intents.hostile + brief.intents.unsubscribe) > 0 && (
        <div className="mt-3 pt-3 border-t border-white/[0.05] flex items-center gap-3 flex-wrap font-mono text-[10px] uppercase tracking-eyebrow">
          <span className="text-cream-subtle">Reply intents:</span>
          {brief.intents.interested > 0 && <IntentChip label="Interested" count={brief.intents.interested} tone="teal" />}
          {brief.intents.question > 0 && <IntentChip label="Question" count={brief.intents.question} tone="amber" />}
          {brief.intents.declined > 0 && <IntentChip label="Declined" count={brief.intents.declined} tone="neutral" />}
          {brief.intents.hostile > 0 && <IntentChip label="Hostile" count={brief.intents.hostile} tone="coral" />}
          {brief.intents.unsubscribe > 0 && <IntentChip label="Unsubscribe" count={brief.intents.unsubscribe} tone="coral" />}
        </div>
      )}
    </div>
  );
}

function BriefStat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "coral" | "amber" | "teal" }) {
  const colorClass = {
    default: "text-cream",
    coral: "text-coral-300",
    amber: "text-amber",
    teal: "text-teal-300",
  }[tone];
  return (
    <div>
      <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-0.5 font-display text-xl ${colorClass}`}>{value}</div>
    </div>
  );
}

function IntentChip({ label, count, tone }: { label: string; count: number; tone: "coral" | "amber" | "teal" | "neutral" }) {
  const colors = {
    coral: "border-coral-400/40 bg-coral-400/[0.08] text-coral-300",
    amber: "border-amber/40 bg-amber/[0.08] text-amber",
    teal: "border-teal-400/40 bg-teal-400/[0.08] text-teal-300",
    neutral: "border-white/[0.10] bg-white/[0.04] text-cream-dim",
  }[tone];
  return (
    <span className={`px-1.5 py-0.5 rounded border ${colors} normal-case font-body`}>
      {label} <span className="font-mono text-[9.5px]">{count}</span>
    </span>
  );
}
