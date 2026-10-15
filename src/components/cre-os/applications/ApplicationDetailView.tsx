"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { ApplicationDetail, ApplicationStatus } from "@/lib/cre-os/lease-application-queries";
import { labelFor, toneFor } from "./ApplicationsView";

/**
 * ApplicationDetailView — one lease application: business, guarantors,
 * financial snapshot, references, signed documents, and review status.
 */
export function ApplicationDetailView({ app }: { app: ApplicationDetail }) {
  const router = useRouter();
  const a = app.raw;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: ApplicationStatus) {
    setBusy(status);
    setError(null);
    try {
      const res = await fetch(`/api/lease-applications/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const rail: RailSection[] = [
    {
      eyebrow: "Applicant",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          {app.owners[0]?.email && <a className="block text-coral-300 hover:underline" href={`mailto:${app.owners[0].email}`}>{app.owners[0].email}</a>}
          {app.owners[0]?.phone && <a className="block text-coral-300 hover:underline" href={`tel:${app.owners[0].phone.replace(/[^\d+]/g, "")}`}>{app.owners[0].phone}</a>}
          {a.lead_id && (
            <Link href={`/cre-os/inbox/${a.lead_id}`} className="block mt-2 px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] text-cream font-medium transition-colors">
              Open lead file →
            </Link>
          )}
          {a.contact_id && (
            <Link href={`/cre-os/relationships/${a.contact_id}`} className="block px-3 py-2 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-cream transition-colors">
              Open contact →
            </Link>
          )}
        </div>
      ),
    },
    {
      eyebrow: "Credit check",
      children: (
        <p className="text-[11px] font-body text-cream-dim leading-relaxed">
          Authorization signed by {app.signatures.map((s) => s.name).join(", ") || "—"}.
          SSN and date of birth are not collected online — send each guarantor your credit-check vendor&apos;s link.
        </p>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-5 pb-16">
        <header>
          <Link href="/cre-os/applications" className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">← Applications</Link>
          <div className="mt-2 flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="font-display font-medium text-3xl text-cream tracking-tight leading-tight">{a.business_legal_name}</h1>
              <div className="mt-1 font-heading text-[14px] text-cream-dim">
                {a.dba ? `dba ${a.dba} · ` : ""}{a.intended_use ?? "Use not stated"}
              </div>
              <div className="mt-2 font-mono text-[11px] text-cream-dim">
                <span className="text-cream-subtle">RE:</span>{" "}
                {app.property?.slug
                  ? <Link className="text-coral-300 hover:underline" href={`/cre-os/properties/${app.property.slug}`}>{app.property.name}</Link>
                  : (a.property_label ?? "No property named")}
                {a.suite ? `, ${a.suite}` : ""} · applied {app.createdRelative}
              </div>
            </div>
            <StatusBadge tone={toneFor(a.status)}>{labelFor(a.status)}</StatusBadge>
          </div>
          {a.status !== "pending_upload" && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(["reviewing", "approved", "declined"] as ApplicationStatus[]).map((s) => (
                <button
                  key={s}
                  disabled={!!busy || a.status === s}
                  onClick={() => setStatus(s)}
                  className="px-3 py-1.5 rounded border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-cream-dim font-heading text-[10px] font-semibold uppercase tracking-eyebrow transition-colors disabled:opacity-40"
                >
                  {busy === s ? "Saving…" : `Mark ${labelFor(s).toLowerCase()}`}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-2 text-[12px] text-coral-300">{error}</p>}
        </header>

        <Panel eyebrow="Documents" num={1} title={`${app.documents.length} file${app.documents.length === 1 ? "" : "s"}`}>
          {app.documents.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-3">No documents received.</p>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {app.documents.map((d) => (
                <li key={d.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-heading text-[10px] uppercase tracking-eyebrow text-cream-subtle">{d.docLabel}</div>
                    <div className="font-body text-[13px] text-cream truncate">{d.fileName}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {d.fileSize !== null && <span className="font-mono text-[10px] text-cream-subtle">{fmtSize(d.fileSize)}</span>}
                    {d.signedUrl
                      ? <a href={d.signedUrl} target="_blank" rel="noopener noreferrer" className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300">Open</a>
                      : <span className="font-mono text-[10px] text-cream-subtle">unavailable</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {app.missingFiles.length > 0 && (
            <p className="mt-3 font-body text-[12px] text-amber">Did not upload: {app.missingFiles.join(", ")} — ask the applicant to email these.</p>
          )}
        </Panel>

        <Panel eyebrow="Business" num={2} title="Entity">
          <Grid rows={[
            ["Legal name", a.business_legal_name],
            ["DBA", a.dba],
            ["Entity", [a.entity_type === "other" ? a.entity_type_other : a.entity_type, a.state_of_formation].filter(Boolean).join(", ")],
            ["FEIN", a.fein],
            ["Years in business", a.years_in_business],
            ["Office", a.business_address],
            ["Phone", a.business_phone],
            ["Email", a.business_email],
            ["Space wanted", [a.desired_sf ? `${a.desired_sf} SF` : null, a.desired_move_in ? `move-in ${a.desired_move_in}` : null].filter(Boolean).join(" · ")],
          ]} />
        </Panel>

        <Panel eyebrow="Owners & guarantors" num={3} title={`${app.owners.length} owner${app.owners.length === 1 ? "" : "s"}`}>
          <div className="space-y-4">
            {app.owners.map((o, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-display text-[15px] text-cream">{o.name}</span>
                  {o.guarantor && <StatusBadge size="xs" tone="teal">Guarantor</StatusBadge>}
                </div>
                <Grid rows={[
                  ["Title", o.title],
                  ["Ownership", o.ownership_pct !== null ? `${o.ownership_pct}%` : null],
                  ["Phone", o.phone],
                  ["Email", o.email],
                  ["Home address", o.home_address],
                ]} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Financial snapshot" num={4} title="As stated by applicant">
          <Grid rows={[
            ["Monthly gross revenue", money(a.monthly_revenue)],
            ["Monthly expenses", money(a.monthly_expenses)],
            ["Cash & savings", money(a.cash_savings)],
            ["Total assets", money(a.total_assets)],
            ["Total liabilities", money(a.total_liabilities)],
            ["Start-up cost, this location", money(a.startup_cost)],
            ["Start-up funding", a.funding_source],
          ]} />
        </Panel>

        <Panel eyebrow="Current location & references" num={5} title={a.current_address ?? "Current location not given"}>
          <Grid rows={[
            ["Tenure", a.current_tenure],
            ["Monthly rent", money(a.current_monthly_rent)],
            ["Landlord", [a.current_landlord, a.current_landlord_phone].filter(Boolean).join(" · ")],
            ...app.references.map((r, i): [string, string] => [`Reference ${i + 1}`, [r.name, r.phone, r.email].filter(Boolean).join(" · ")]),
          ]} />
          {a.notes && <p className="mt-3 font-body text-[12px] text-cream-dim leading-relaxed"><span className="text-cream-subtle">Applicant notes: </span>{a.notes}</p>}
        </Panel>
      </div>
    </AppShell>
  );
}

function Grid({ rows }: { rows: Array<[string, unknown]> }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (shown.length === 0) return <p className="mt-1 font-body text-[12px] text-cream-subtle">—</p>;
  return (
    <dl className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
      {shown.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] pb-1">
          <dt className="font-body text-[11px] text-cream-subtle">{k}</dt>
          <dd className="font-mono text-[12px] text-cream text-right break-words">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function money(n: unknown): string | null {
  if (n === null || n === undefined || n === "") return null;
  return `$${Math.round(Number(n)).toLocaleString("en-US")}`;
}

function fmtSize(b: number): string {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
