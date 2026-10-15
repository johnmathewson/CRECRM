"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { ApplicationListRow, ApplicationStatus } from "@/lib/cre-os/lease-application-queries";

/**
 * ApplicationsView — commercial lease applications from stewardshipcre.com,
 * newest first. Mobile-first cards; tap through to the full file + docs.
 */

type Bucket = "open" | "approved" | "declined" | "incomplete" | "all";

export function ApplicationsView({ applications }: { applications: ApplicationListRow[] }) {
  const [bucket, setBucket] = useState<Bucket>("open");

  const inBucket = (a: ApplicationListRow, b: Bucket) => {
    switch (b) {
      case "open": return a.status === "submitted" || a.status === "reviewing";
      case "approved": return a.status === "approved";
      case "declined": return a.status === "declined" || a.status === "withdrawn";
      case "incomplete": return a.status === "pending_upload";
      default: return true;
    }
  };

  const counts = useMemo(() => ({
    open: applications.filter((a) => inBucket(a, "open")).length,
    approved: applications.filter((a) => inBucket(a, "approved")).length,
    declined: applications.filter((a) => inBucket(a, "declined")).length,
    incomplete: applications.filter((a) => inBucket(a, "incomplete")).length,
    all: applications.length,
  }), [applications]);

  const filtered = applications.filter((a) => inBucket(a, bucket));

  const rail: RailSection[] = [
    {
      eyebrow: "How applications arrive",
      children: (
        <div className="text-[11px] font-body text-cream-dim leading-relaxed space-y-1.5">
          <p>Tenants apply at <span className="text-cream">stewardshipcre.com/lease-application</span> or from a listing&apos;s Apply button.</p>
          <p>Each one lands here and as a <span className="text-coral-300">hot lease lead</span> in Communications.</p>
          <p><span className="text-cream">Incomplete</span> = the applicant left before their files finished uploading.</p>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        <header>
          <Eyebrow tone="coral">Leasing · Applications</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Lease applications</h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            {counts.open} awaiting review · {counts.approved} approved · {counts.all} total.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <Chip label="To review" count={counts.open} active={bucket === "open"} onClick={() => setBucket("open")} />
          <Chip label="Approved" count={counts.approved} active={bucket === "approved"} onClick={() => setBucket("approved")} />
          <Chip label="Declined" count={counts.declined} active={bucket === "declined"} onClick={() => setBucket("declined")} />
          <Chip label="Incomplete" count={counts.incomplete} active={bucket === "incomplete"} onClick={() => setBucket("incomplete")} />
          <Chip label="All" count={counts.all} active={bucket === "all"} onClick={() => setBucket("all")} />
        </div>

        <div className="space-y-3 pb-8">
          {filtered.length === 0 ? (
            <Panel>
              <p className="font-body text-[13px] text-cream-subtle py-8 text-center">No applications here yet.</p>
            </Panel>
          ) : (
            filtered.map((a) => (
              <Link
                key={a.id}
                href={`/cre-os/applications/${a.id}`}
                className="block rounded-md p-4 border border-white/[0.05] bg-steward-mid/40 hover:border-coral-400/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-display font-medium text-base text-cream truncate">{a.businessLegalName}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">
                      {[a.primaryName, a.primaryEmail].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <StatusBadge size="xs" tone={toneFor(a.status)}>{labelFor(a.status)}</StatusBadge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px]">
                  <span className="text-coral-300">{a.propertyLabel ? `${a.propertyLabel}${a.suite ? `, ${a.suite}` : ""}` : "No property named"}</span>
                  {a.intendedUse && <span className="text-cream">{a.intendedUse}</span>}
                  {a.monthlyRevenue !== null && <span className="text-cream-dim">${Math.round(a.monthlyRevenue).toLocaleString()}/mo rev</span>}
                  <span className="text-cream-dim">{a.documentCount} doc{a.documentCount === 1 ? "" : "s"}</span>
                  <span className="text-cream-subtle">{a.createdRelative}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

export function toneFor(s: ApplicationStatus): "coral" | "teal" | "amber" | "neutral" {
  if (s === "submitted") return "coral";
  if (s === "reviewing") return "amber";
  if (s === "approved") return "teal";
  return "neutral";
}

export function labelFor(s: ApplicationStatus): string {
  switch (s) {
    case "pending_upload": return "Incomplete";
    case "submitted": return "New";
    case "reviewing": return "Reviewing";
    case "approved": return "Approved";
    case "declined": return "Declined";
    case "withdrawn": return "Withdrawn";
  }
}

function Chip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded border transition-colors ${
        active ? "border-coral-400 bg-coral-400/[0.15] text-cream" : "border-white/15 bg-white/[0.02] text-cream-dim hover:bg-white/[0.06]"
      }`}
    >
      <span className="font-heading text-[10px] font-semibold uppercase tracking-eyebrow">{label}</span>
      <span className={`font-mono text-[11px] font-semibold ${active ? "text-coral-300" : "text-cream-dim"}`}>{count}</span>
    </button>
  );
}
