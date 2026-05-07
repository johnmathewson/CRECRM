"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { PortalSnapshot, PortalToken, PortalAudience, PortalCandidate, PortalContactCandidate } from "@/lib/cre-os/portal-queries";
import { CreatePortalDialog } from "./CreatePortalDialog";
import { PortalCard } from "./PortalCard";

type AudienceFilter = "all" | PortalAudience;
type StatusFilter = "active" | "all" | "expired" | "revoked";

/**
 * PortalsView — the admin command surface for owner + investor magic links.
 * Lists active links, lets John create new ones, and revoke stale ones.
 *
 * The marketing site (stewardshipcre.com) renders the actual dashboard the
 * link recipient sees. This screen is the *who has access* view.
 */
export function PortalsView({
  snapshot,
  candidates,
}: {
  snapshot: PortalSnapshot;
  candidates: { properties: PortalCandidate[]; contacts: PortalContactCandidate[] };
}) {
  const router = useRouter();
  const search = useSearchParams();

  // Auto-open create dialog when /cre-os/portals?new=1 (or property=ID).
  const initialOpen = search.get("new") === "1" || !!search.get("property");
  const [createOpen, setCreateOpen] = useState(initialOpen);
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  // Pre-select properties / audience from URL params when the dialog opens.
  const presetPropertyIds = useMemo(() => {
    const raw = search.get("property");
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [search]);
  const presetAudience = (search.get("audience") as PortalAudience) || "owner";

  // Strip the launcher params from the URL once we've consumed them so
  // refresh doesn't reopen the dialog.
  useEffect(() => {
    if (initialOpen && (search.has("new") || search.has("property") || search.has("audience"))) {
      const url = new URL(window.location.href);
      url.searchParams.delete("new");
      url.searchParams.delete("property");
      url.searchParams.delete("audience");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return snapshot.tokens.filter((t) => {
      if (audienceFilter !== "all" && t.audience !== audienceFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [snapshot.tokens, audienceFilter, statusFilter]);

  function refresh() {
    router.refresh();
  }

  // ── Right rail ────────────────────────────────────────────────────────
  const rail: RailSection[] = [
    {
      eyebrow: "Portal pulse",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Active links" value={snapshot.totals.active.toString()} />
          <RailStat label="Owner · Investor" value={`${snapshot.totals.ownerActive} · ${snapshot.totals.investorActive}`} />
          <RailStat label="Viewed in last 7d" value={snapshot.totals.viewedThisWeek.toString()} />
          <RailStat label="Ever viewed" value={snapshot.totals.everViewed.toString()} />
          <RailStat label="Expired" value={snapshot.totals.expired.toString()} />
          <RailStat label="Revoked" value={snapshot.totals.revoked.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "What stands out",
      insights: buildInsights(snapshot),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <button
            onClick={() => setCreateOpen(true)}
            className="block w-full text-left px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
          >
            Generate new link
          </button>
          <a
            href="https://stewardshipcre.com"
            target="_blank"
            rel="noreferrer"
            className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.02] font-body text-[11px] text-cream-dim hover:text-cream transition-colors"
          >
            View marketing site →
          </a>
          <div className="block px-3 py-2 rounded border border-white/[0.04] bg-white/[0.01] font-body text-[11px] text-cream-subtle">
            Email send-link <span className="ml-2 font-mono text-[9px] uppercase">soon</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        {/* Header */}
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Eyebrow tone="coral">Portals · Access control</Eyebrow>
            <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Owner & investor portals</h1>
            <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
              {snapshot.synthesis}
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="shrink-0 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
          >
            + Generate link
          </button>
        </header>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <CommandStat label="Active links" value={snapshot.totals.active.toString()} caption={`${snapshot.totals.ownerActive} owner · ${snapshot.totals.investorActive} investor`} />
          <CommandStat label="Viewed this week" value={snapshot.totals.viewedThisWeek.toString()} caption="Active links opened in last 7d" />
          <CommandStat label="Ever opened" value={snapshot.totals.everViewed.toString()} caption="Across active + expired + revoked" />
          <CommandStat label="Inactive" value={(snapshot.totals.expired + snapshot.totals.revoked).toString()} caption={`${snapshot.totals.expired} expired · ${snapshot.totals.revoked} revoked`} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <ChipGroup
            label="Audience"
            value={audienceFilter}
            onChange={(v) => setAudienceFilter(v as AudienceFilter)}
            options={[
              { value: "all", label: "All" },
              { value: "owner", label: `Owner · ${snapshot.totals.ownerActive}` },
              { value: "investor", label: `Investor · ${snapshot.totals.investorActive}` },
            ]}
          />
          <ChipGroup
            label="Status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            options={[
              { value: "active", label: `Active · ${snapshot.totals.active}` },
              { value: "expired", label: `Expired · ${snapshot.totals.expired}` },
              { value: "revoked", label: `Revoked · ${snapshot.totals.revoked}` },
              { value: "all", label: `All · ${snapshot.tokens.length}` },
            ]}
          />
        </div>

        {/* Token list */}
        <section>
          <Eyebrow tone="coral" num={1}>Magic links</Eyebrow>
          {filtered.length === 0 ? (
            <div className="mt-3 rounded border border-white/[0.05] bg-steward-surface/30 p-8 text-center">
              {snapshot.tokens.length === 0 ? (
                <>
                  <p className="font-heading text-[13px] text-cream-dim">No links yet.</p>
                  <p className="mt-1 font-body text-[11px] text-cream-subtle">
                    Generate the first one to share a property's listing performance with an owner — or pursuit progress with an investor.
                  </p>
                  <button
                    onClick={() => setCreateOpen(true)}
                    className="mt-4 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
                  >
                    Generate first link
                  </button>
                </>
              ) : (
                <p className="font-body text-[11px] text-cream-subtle">
                  No links match the current filters.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {filtered.map((t) => (
                <PortalCard key={t.id} token={t} onChanged={refresh} />
              ))}
            </div>
          )}
        </section>
      </div>

      {createOpen && (
        <CreatePortalDialog
          properties={candidates.properties}
          contacts={candidates.contacts}
          presetPropertyIds={presetPropertyIds}
          presetAudience={presetAudience}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function CommandStat({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded border border-white/[0.05] bg-steward-surface/40 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-display font-medium text-2xl text-cream tracking-tight">{value}</div>
      <div className="mt-0.5 font-body text-[10px] text-cream-subtle">{caption}</div>
    </div>
  );
}

function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</span>
      <div className="flex items-center gap-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={`px-2.5 py-1 rounded font-heading text-[10px] uppercase tracking-eyebrow font-semibold transition-colors ${
                active
                  ? "bg-coral-400/[0.15] text-coral-200 ring-1 ring-inset ring-coral-400/30"
                  : "bg-white/[0.04] text-cream-dim hover:bg-white/[0.08] hover:text-cream"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
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

function buildInsights(snapshot: PortalSnapshot) {
  const insights: { id: string; confidence: number; headline: string; caption: string; tone: "coral" | "teal" | "amber" | "neutral" }[] = [];

  // Stale active links (no view since creation, > 7 days old)
  const stale = snapshot.tokens.filter((t) =>
    t.status === "active" &&
    t.lastViewedAt === null &&
    new Date(t.createdAt).getTime() < Date.now() - 7 * 86400000
  );
  if (stale.length > 0) {
    insights.push({
      id: "stale",
      confidence: 90,
      headline: `${stale.length} link${stale.length === 1 ? "" : "s"} never opened`,
      caption: stale.length === 1
        ? `"${stale[0].label}" was sent over a week ago and hasn't been clicked. Consider following up.`
        : `Sent over a week ago, no opens yet. The recipient may have lost the email — resend or follow up.`,
      tone: "amber",
    });
  }

  // Engaged owners (active link viewed in last 3 days)
  const hot = snapshot.tokens.filter((t) =>
    t.status === "active" &&
    t.daysSinceLastView !== null &&
    t.daysSinceLastView <= 3
  );
  if (hot.length > 0) {
    insights.push({
      id: "hot",
      confidence: 95,
      headline: `${hot.length} engaged this week`,
      caption: hot.length === 1
        ? `"${hot[0].label}" opened ${hot[0].daysSinceLastView === 0 ? "today" : hot[0].daysSinceLastView + "d ago"}. Good moment for a check-in.`
        : `${hot.length} portals opened in the last 3 days — recipients are actively tracking.`,
      tone: "teal",
    });
  }

  // Expiring soon (within 14 days)
  const expiring = snapshot.tokens.filter((t) =>
    t.status === "active" &&
    t.daysUntilExpiry !== null &&
    t.daysUntilExpiry <= 14
  );
  if (expiring.length > 0) {
    insights.push({
      id: "expiring",
      confidence: 100,
      headline: `${expiring.length} expiring soon`,
      caption: `Within 14 days. Renew before they go dark or the recipient will hit a "link expired" page.`,
      tone: "amber",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "calm",
      confidence: 100,
      headline: "Portals are calm",
      caption: "No stale links, no expiring tokens, no abandoned access. Nothing requires action right now.",
      tone: "neutral",
    });
  }
  return insights;
}
