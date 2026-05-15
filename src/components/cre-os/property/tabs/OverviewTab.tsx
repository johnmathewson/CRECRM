"use client";

import { useState } from "react";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { TaskRow } from "@/components/cre-os/tasks/TaskRow";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

const fmtMoney = (n: number | null) => {
  if (n === null || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(0) + "K";
  return "$" + n.toLocaleString();
};

/**
 * Overview tab — the at-a-glance everything-about-this-asset view. Three
 * primary panels stack on the left (key facts, key contacts, open tasks);
 * leads + linked deals stack on the right.
 */
export function OverviewTab({ p }: { p: PropertyDetail }) {
  // Show the CoStar-derived owner/loan/listing panel only when we have any
  // of those fields populated (cold prospects mostly; warm assets may have
  // a subset).
  const hasOwnershipData = !!(p.trueOwnerName || p.ownerNameRaw || p.ownerPhone || p.trueOwnerPhone);
  const hasLoanData = !!(p.mortgageMaturityDate || p.mortgageLender || p.mortgageBalance);
  const hasMarketData = !!(p.forSaleStatus || p.daysOnMarket || p.percentLeased || p.buildingClass);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Panel eyebrow="Asset facts" num={1} title="Key details">
          <KeyFactsGrid p={p} />
          {p.description && (
            <p className="mt-4 font-body text-[13px] text-cream-dim leading-relaxed">{p.description}</p>
          )}
          {p.notes && (
            <div className="mt-4 pt-4 border-t border-white/[0.04]">
              <Eyebrow tone="muted">Notes</Eyebrow>
              <p className="mt-2 font-body text-[12px] text-cream-dim whitespace-pre-wrap">{p.notes}</p>
            </div>
          )}
        </Panel>

        {/* Marketing notes — anchor intel for AI outreach about THIS property.
            Gets injected into every personalizer prompt that involves this asset.
            Use it for: "Lead with 8.69% cap, not asking price", "Owner motivated
            for 60-day close", "Patel buyer pool is hot here — assume hospitality
            fluency", etc. Edits save instantly — no rebuild. */}
        <Panel eyebrow="Marketing notes" num={2} title="What the AI should anchor on">
          <MarketingNotesEditor propertyId={p.id} initial={p.marketingNotes ?? ""} />
        </Panel>

        {(hasOwnershipData || hasLoanData || hasMarketData) && (
          <Panel eyebrow="Ownership & debt" num={3} title="What CoStar knows">
            <OwnerLoanPanel p={p} />
          </Panel>
        )}

        <Panel eyebrow="Key contacts" num={2} title="People on this asset">
          {p.keyContacts.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">
              No contacts linked yet. Tasks and activities you log against this property will surface their participants here.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {p.keyContacts.map((c) => (
                <div key={c.id} className="border border-white/[0.05] rounded p-3 bg-white/[0.02]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-heading text-[13px] font-semibold text-cream truncate">{c.fullName}</div>
                      {c.email && (
                        <div className="font-mono text-[10px] text-cream-subtle truncate mt-0.5">{c.email}</div>
                      )}
                      {c.phone && (
                        <div className="font-mono text-[10px] text-cream-subtle truncate mt-0.5">{c.phone}</div>
                      )}
                    </div>
                    <StatusBadge tone="neutral" size="xs">{c.role.replace("_", " ")}</StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Open tasks" num={3} title="What's queued">
          {p.tasks.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">
              No open tasks on this property. Use the {"\""}+ Task{"\""} button on the masthead to add one.
            </p>
          ) : (
            <div className="space-y-2">
              {p.tasks.map((t) => (
                <TaskRow key={t.id} id={t.id} title={t.title} due={t.due} tone={t.tone} status={t.status} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel eyebrow="Inbound" num={4} title={`Leads (${p.leads.length})`}>
          {p.leads.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">No inbound leads referencing this asset.</p>
          ) : (
            <div className="space-y-3">
              {p.leads.slice(0, 6).map((l) => (
                <a
                  key={l.id}
                  href={`/cre-os/inbox/${l.id}`}
                  className="block border border-white/[0.05] rounded p-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-heading text-[12px] font-semibold text-cream truncate">
                      {l.senderName || l.senderEmail || "Unknown sender"}
                    </div>
                    {l.urgency && (
                      <StatusBadge size="xs" tone={l.urgency === "hot" ? "coral" : l.urgency === "warm" ? "amber" : "neutral"}>
                        {l.urgency}
                      </StatusBadge>
                    )}
                  </div>
                  {l.qualifierSummary && (
                    <p className="mt-1 font-body text-[11px] text-cream-dim leading-snug line-clamp-2">
                      {l.qualifierSummary}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Linked deals" num={5} title={`Deals (${p.deals.filter(d => !d.isClosed && !d.isDead).length} open)`}>
          {p.deals.length === 0 ? (
            <p className="font-body text-[13px] text-cream-subtle py-4">No deals tied to this asset yet.</p>
          ) : (
            <div className="space-y-2">
              {p.deals.map((d) => (
                <a
                  key={d.id}
                  href={`/cre-os/pipeline?deal=${d.id}`}
                  className="block border border-white/[0.05] rounded p-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-heading text-[12px] font-semibold text-cream truncate">
                      {d.dealName || "(unnamed deal)"}
                    </div>
                    {d.currentStage && (
                      <StatusBadge size="xs" tone={d.isClosed ? "teal" : d.isDead ? "neutral" : "coral"}>
                        {d.currentStage}
                      </StatusBadge>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[10px] text-cream-subtle">
                    {d.dealType?.replace("_", " ") ?? "—"}
                    {d.price && <> · {fmtMoney(d.price)}</>}
                    {d.probabilityPct !== null && <> · {Math.round(d.probabilityPct)}%</>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function KeyFactsGrid({ p }: { p: PropertyDetail }) {
  const facts: Array<[string, string | null]> = [
    ["Asset type", p.assetType ? p.assetType.replace("_", " ") : null],
    ["Status", p.status?.replace("_", " ") ?? null],
    ["Pipeline stage", p.pipelineStage],
    ["Your role", p.yourRole?.replace("_", " ") ?? null],
    ["Transaction", p.transactionType?.replace("_", " ") ?? null],
    ["Asking price", p.askingPrice ? fmtMoney(p.askingPrice) : null],
    ["NOI (in-place)", p.noi ? fmtMoney(p.noi) : null],
    ["Cap rate", p.capRate ? `${(p.capRate * 100).toFixed(2)}%` : null],
    ["Total SF", p.sqft ? p.sqft.toLocaleString() : null],
    ["Year built", p.yearBuilt ? p.yearBuilt.toString() : null],
    ["Occupancy", p.occupancyPct !== null ? `${(p.occupancyPct * 100).toFixed(0)}%` : null],
    ["$/SF", p.askingPrice && p.sqft ? "$" + (p.askingPrice / p.sqft).toFixed(2) : null],
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
      {facts.map(([k, v]) => (
        <div key={k}>
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{k}</div>
          <div className="mt-0.5 font-heading text-[14px] text-cream">{v ?? <span className="text-cream-subtle">—</span>}</div>
        </div>
      ))}
    </div>
  );
}

// ── Marketing notes editor ──────────────────────────────────────────────
// Per-property anchor intel for the AI personalizer. Edits flow through
// PATCH /api/properties/[id] and become live for the next draft.
function MarketingNotesEditor({ propertyId, initial }: { propertyId: string; initial: string }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = value !== initial && value !== (savedAt ? value : initial);
  // ^ dirty = the textarea differs from what was last loaded OR last saved

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketing_notes: value }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="font-body text-[12px] text-cream-subtle leading-relaxed">
        Free-form intel that gets injected into every AI draft about this property.
        Examples: <span className="italic">&ldquo;Lead with the 8.69% cap, not the asking price.&rdquo;</span>{" "}
        <span className="italic">&ldquo;Owner motivated for a 60-day close.&rdquo;</span>{" "}
        <span className="italic">&ldquo;Assume hospitality fluency — don&rsquo;t over-explain per-key economics.&rdquo;</span>
      </p>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={Math.max(4, Math.min(10, value.split("\n").length + 1))}
        placeholder="(optional — leave empty and the AI will work from the property's structured data alone)"
        className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-teal-400/40 focus:outline-none font-body text-base lg:text-[12.5px] text-cream placeholder:text-cream-subtle leading-relaxed resize-y"
      />
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
          {error && <span className="text-coral-300">Save failed: {error}</span>}
          {!error && savedAt && !dirty && <span className="text-teal-300">Saved · live now</span>}
          {!error && !savedAt && dirty && <span className="text-amber">Unsaved changes</span>}
          {!error && !savedAt && !dirty && <span>Edits save instantly to every future AI draft</span>}
        </div>
        <button
          onClick={save}
          disabled={saving || (!dirty && !!savedAt)}
          className="px-3 py-1.5 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.18] disabled:opacity-40 font-mono text-[10px] uppercase tracking-eyebrow text-teal-300"
        >
          {saving ? "Saving…" : savedAt && !dirty ? "Saved ✓" : "Save notes"}
        </button>
      </div>
    </div>
  );
}

// ── Owner / Loan / Market panel ─────────────────────────────────────────
// Surfaces the rich CoStar-derived data (LLC unmask, debt, listing state,
// market context) on the property workspace. Populated for cold prospects
// from the CoStar import; partially populated for warm assets where the
// CoStar fields were carried over.
function OwnerLoanPanel({ p }: { p: PropertyDetail }) {
  const refiYears = p.mortgageMaturityDate
    ? (new Date(p.mortgageMaturityDate).getTime() - Date.now()) / (1000 * 3600 * 24 * 365.25)
    : null;
  return (
    <div className="space-y-5">
      {/* Owner */}
      {(p.trueOwnerName || p.ownerNameRaw) && (
        <section>
          <Eyebrow tone="muted">Owner</Eyebrow>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {p.trueOwnerName && (
              <OwnerCard
                label="True Owner (LLC unmask)"
                name={p.trueOwnerName}
                contactName={p.trueOwnerContactName}
                phone={p.trueOwnerPhone}
                address={p.trueOwnerAddress}
                city={p.trueOwnerCity}
                state={p.trueOwnerState}
                zip={p.trueOwnerZip}
                tone="coral"
              />
            )}
            {p.ownerNameRaw && p.ownerNameRaw !== p.trueOwnerName && (
              <OwnerCard
                label="Recorded Owner"
                name={p.ownerNameRaw}
                contactName={p.ownerContactName}
                phone={p.ownerPhone}
                address={p.ownerMailingAddress}
                city={p.ownerMailingCity}
                state={p.ownerMailingState}
                zip={p.ownerMailingZip}
              />
            )}
          </div>
        </section>
      )}

      {/* Debt */}
      {(p.mortgageMaturityDate || p.mortgageLender || p.mortgageBalance) && (
        <section>
          <Eyebrow tone="muted">Debt</Eyebrow>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
            <Fact label="Loan maturity" value={p.mortgageMaturityDate ? new Date(p.mortgageMaturityDate).toLocaleDateString() : null} tone={refiYears != null && refiYears < 2 ? "coral" : "default"} />
            <Fact label="Refi window" value={refiYears != null ? `${refiYears.toFixed(1)} yrs` : null} tone={refiYears != null && refiYears < 2 ? "coral" : "default"} />
            <Fact label="Origination" value={p.mortgageOriginationDate ? new Date(p.mortgageOriginationDate).toLocaleDateString() : null} />
            <Fact label="Origination amount" value={p.mortgageBalance ? fmtMoney(p.mortgageBalance) : null} />
            <Fact label="Lender" value={p.mortgageLender} />
            <Fact label="Rate" value={p.loanInterestRate != null ? `${p.loanInterestRate}%` : null} />
            <Fact label="Rate type" value={p.loanInterestRateType} />
            <Fact label="Loan type" value={p.loanType} />
          </div>
        </section>
      )}

      {/* Listing / market */}
      {(p.forSaleStatus || p.daysOnMarket != null || p.percentLeased != null || p.buildingClass) && (
        <section>
          <Eyebrow tone="muted">Listing & market</Eyebrow>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
            <Fact label="For-sale status" value={p.forSaleStatus} tone="coral" />
            <Fact label="For-sale price" value={p.forSalePrice ? fmtMoney(p.forSalePrice) : null} />
            <Fact label="Days on market" value={p.daysOnMarket?.toString() ?? null} />
            <Fact label="Last sale" value={p.lastSaleDate ? new Date(p.lastSaleDate).toLocaleDateString() : null} />
            <Fact label="Last sale price" value={p.lastSalePrice ? fmtMoney(p.lastSalePrice) : null} />
            <Fact label="Years held" value={p.yearsOwned != null ? `${p.yearsOwned}y` : null} />
            <Fact label="% Leased" value={p.percentLeased != null ? `${p.percentLeased}%` : null} />
            <Fact label="Vacancy" value={p.vacancyPct != null ? `${p.vacancyPct}%` : null} />
            <Fact label="Bldg class" value={p.buildingClass} />
            <Fact label="Tenancy" value={p.tenancy} />
            <Fact label="Submarket" value={p.submarket} />
            <Fact label="Market" value={p.marketName} />
          </div>
        </section>
      )}

      {/* Service contacts (property manager / listing broker on CoStar's record) */}
      {(p.propertyManagerName || p.salesContactName || p.leasingContactName) && (
        <section>
          <Eyebrow tone="muted">Service contacts</Eyebrow>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {p.propertyManagerName && (
              <ContactCard label="Property Mgr" name={p.propertyManagerName} phone={p.propertyManagerPhone} />
            )}
            {p.salesContactName && (
              <ContactCard label="Sales Contact" name={p.salesContactName} phone={p.salesContactPhone} />
            )}
            {p.leasingContactName && (
              <ContactCard label="Leasing Contact" name={p.leasingContactName} phone={p.leasingContactPhone} />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function OwnerCard({
  label, name, contactName, phone, address, city, state, zip, tone = "default",
}: {
  label: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  tone?: "default" | "coral";
}) {
  const border = tone === "coral" ? "border-coral-400/30 bg-coral-400/[0.04]" : "border-white/[0.06] bg-white/[0.02]";
  const labelColor = tone === "coral" ? "text-coral-300" : "text-cream-subtle";
  return (
    <div className={`rounded border ${border} p-3`}>
      <div className={`font-mono text-[9.5px] uppercase tracking-eyebrow ${labelColor}`}>{label}</div>
      <div className="mt-1 font-heading text-[13px] text-cream font-semibold">{name}</div>
      {contactName && <div className="font-body text-[11.5px] text-cream-dim">c/o {contactName}</div>}
      {phone && <div className="mt-1 font-mono text-[11px] text-teal-300">📞 {phone}</div>}
      {(address || city || state || zip) && (
        <div className="mt-1 font-body text-[11px] text-cream-subtle leading-snug">
          {address && <div>{address}</div>}
          <div>{[city, state, zip].filter(Boolean).join(", ")}</div>
        </div>
      )}
    </div>
  );
}

function ContactCard({ label, name, phone }: { label: string; name: string; phone?: string | null }) {
  return (
    <div className="rounded border border-white/[0.05] bg-white/[0.02] p-3">
      <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-heading text-[12.5px] text-cream font-semibold truncate">{name}</div>
      {phone && <div className="mt-0.5 font-mono text-[10.5px] text-teal-300">📞 {phone}</div>}
    </div>
  );
}

function Fact({ label, value, tone = "default" }: { label: string; value: string | null | undefined; tone?: "default" | "coral" }) {
  const color = tone === "coral" ? "text-coral-300" : "text-cream";
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-0.5 font-heading text-[13px] ${color}`}>
        {value ?? <span className="text-cream-subtle">—</span>}
      </div>
    </div>
  );
}
