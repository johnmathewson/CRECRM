"use client";

import { useState } from "react";
import { Panel } from "@/components/cre-os/Panel";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { StatusBadge } from "@/components/cre-os/StatusBadge";
import { TaskRow } from "@/components/cre-os/tasks/TaskRow";
import { MarketingCopyPanel } from "@/components/cre-os/property/MarketingCopyPanel";
import { OmPanel } from "@/components/cre-os/property/OmPanel";
import type { PropertyDetail, DocumentInventoryItem } from "@/lib/cre-os/property-queries";

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
  const hasOwnershipData =
    !!(p.trueOwnerName || p.ownerNameRaw || p.ownerPhone || p.trueOwnerPhone || p.recordedOwnerName);
  const hasLoanData = !!(p.mortgageMaturityDate || p.mortgageLender || p.mortgageBalance || p.loanOriginator);
  const hasMarketData = !!(p.forSaleStatus || p.daysOnMarket || p.percentLeased || p.buildingClass);
  const isHospitality = p.assetType === "hospitality" || !!p.hotelBrand || !!p.rooms;
  const hasMarketingAssets =
    !!p.headline || p.highlights.length > 0 || p.images.length > 0 || !!p.crexiUrl || !!p.loopnetUrl;

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

        {/* Marketing assets — fuel for the future OM/flyer/listing-description
            generator. Headline, highlights, image count, external listing URLs.
            Always rendered (empty state has its own copy) so the broker sees
            the gap and can fill it via Edit details. */}
        {(hasMarketingAssets || isHospitality) && (
          <Panel eyebrow="Marketing assets" num={2} title="Inputs the marketing engine will use">
            <MarketingAssetsPanel p={p} />
          </Panel>
        )}

        {/* Hotel intelligence — only renders for hospitality assets. */}
        {isHospitality && (
          <Panel eyebrow="Hotel intelligence" num={3} title="Brand · class · keys">
            <HotelIntelPanel p={p} />
          </Panel>
        )}

        {/* Listing copy — the AI-generated headline + description + highlights
            that go to CREXi, LoopNet, the firm website, and inbound listing
            assessments. Editable inline + regenerable. The agent pulls
            property facts + nearby comps + voice profile, writes a draft, and
            John saves what he likes. */}
        <Panel eyebrow="Listing copy" num={4} title="AI-drafted public marketing">
          <MarketingCopyPanel
            propertyId={p.id}
            initialHeadline={p.headline}
            initialDescription={p.description}
            initialHighlights={p.highlights}
            initialInvestmentHighlights={p.investmentHighlights}
          />
        </Panel>

        {/* OM PDF — the deliverable John hands to a buyer post-CA. Pulls
            from the live marketing copy, so the workflow is: tune the
            copy in panel #4 → click Regenerate OM here → share the link. */}
        <Panel eyebrow="Offering Memorandum" num={5} title="Multi-page deliverable PDF">
          <OmPanel
            propertyId={p.id}
            omPdfUrl={p.omPdfUrl}
            omGeneratedAt={p.omGeneratedAt}
          />
        </Panel>

        {/* Marketing notes — anchor intel for AI outreach about THIS property.
            Gets injected into every personalizer prompt that involves this asset.
            Use it for: "Lead with 8.69% cap, not asking price", "Owner motivated
            for 60-day close", "Patel buyer pool is hot here — assume hospitality
            fluency", etc. Edits save instantly — no rebuild. */}
        <Panel eyebrow="Marketing notes" num={6} title="What the AI should anchor on">
          <MarketingNotesEditor propertyId={p.id} initial={p.marketingNotes ?? ""} />
        </Panel>

        {/* Document inventory — list of marketing/DD documents and their
            disclosure tier. The AI reads this when buyers ask for specific
            documents so it knows what to release and what to gate. */}
        <Panel eyebrow="Document inventory" num={3} title="What's releasable and to whom">
          <DocumentInventoryEditor propertyId={p.id} initial={p.documentInventory ?? []} />
        </Panel>

        {(hasOwnershipData || hasLoanData || hasMarketData) && (
          <Panel eyebrow="Ownership & debt" num={4} title="What CoStar knows">
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
  // Compute price-per-SF (use stored if present, else derived from asking/SF).
  const pricePerSf = p.pricePerSf ?? (p.askingPrice && p.sqft ? p.askingPrice / p.sqft : null);

  // Lease rate is only meaningful on lease transactions; otherwise hide.
  const showLeaseRate = p.transactionType === "lease" || p.transactionType === "sale_or_lease";

  const facts: Array<[string, string | null]> = [
    ["Asset type", p.assetType ? p.assetType.replace("_", " ") : null],
    ["Sub-type", p.subType?.replace("_", " ") ?? null],
    ["Status", p.status?.replace("_", " ") ?? null],
    ["Pipeline stage", p.pipelineStage],
    ["Your role", p.yourRole?.replace("_", " ") ?? null],
    ["Transaction", p.transactionType?.replace("_", " ") ?? null],
    ["Asking price", p.askingPrice ? fmtMoney(p.askingPrice) : null],
    ...(showLeaseRate ? ([["Lease rate", p.leaseRate ? `$${p.leaseRate.toFixed(2)}/SF` : null]] as Array<[string, string | null]>) : []),
    ["NOI (in-place)", p.noi ? fmtMoney(p.noi) : null],
    ["Cap rate", p.capRate ? `${(p.capRate * 100).toFixed(2)}%` : null],
    ["$/SF", pricePerSf ? "$" + pricePerSf.toFixed(2) : null],
    ["Total SF", p.sqft ? p.sqft.toLocaleString() : null],
    ["Acreage", p.acreage ? `${p.acreage.toFixed(2)}` : null],
    ["Units", p.units ? p.units.toLocaleString() : null],
    ["Year built", p.yearBuilt ? p.yearBuilt.toString() : null],
    ["Occupancy", p.occupancyPct !== null ? `${(p.occupancyPct * 100).toFixed(0)}%` : null],
    ["% Leased", p.percentLeased != null ? `${p.percentLeased}%` : null],
    ["Vacancy", p.vacancyPct != null ? `${p.vacancyPct}%` : null],
    ["Rent $/SF/yr", p.rentPerSfYr ? `$${p.rentPerSfYr.toFixed(2)}` : null],
    ["Bldg class", p.buildingClass],
    ["Tenancy", p.tenancy],
    ["Stories", p.numberOfStories?.toString() ?? null],
    ["Buildings", p.totalBuildings?.toString() ?? null],
    ["Parking spaces", p.parkingSpaces?.toLocaleString() ?? null],
    ["Parking ratio", p.parkingRatio],
    ["Zoning", p.zoning],
    ["Days on market", p.daysOnMarket?.toString() ?? null],
    ["Submarket", p.submarket ?? p.submarketCluster],
    ["Market", p.marketName],
    ["Tax/yr", p.taxTotal ? fmtMoney(p.taxTotal) : null],
    ["Tax/SF", p.taxPerSf ? `$${p.taxPerSf.toFixed(2)}` : null],
    ["Estimated value", p.estimatedValue ? fmtMoney(p.estimatedValue) : null],
    ["Prospector score", p.prospectorScore != null ? p.prospectorScore.toFixed(0) : null],
  ];

  // Only render facts that have a value — keeps the grid scannable.
  const visible = facts.filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
      {visible.map(([k, v]) => (
        <div key={k}>
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{k}</div>
          <div className="mt-0.5 font-heading text-[14px] text-cream">{v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Marketing assets panel — the raw material for the future
// marketing engine. Headline, highlights, image count, external listing
// URLs, plus a publish-to-website status indicator. Conditional render —
// hidden entirely when there's nothing marketing-shaped on file yet.
function MarketingAssetsPanel({ p }: { p: PropertyDetail }) {
  const hasAny =
    !!p.headline ||
    p.highlights.length > 0 ||
    p.images.length > 0 ||
    !!p.crexiUrl ||
    !!p.loopnetUrl ||
    !!p.description;
  if (!hasAny) {
    return (
      <p className="font-body text-[13px] text-cream-subtle py-2">
        No marketing assets on file yet. Add a headline, highlights, and images via Edit details, or wait for the
        listing-description generator to seed them.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {p.headline && (
        <section>
          <Eyebrow tone="muted">Headline</Eyebrow>
          <p className="mt-1 font-display text-[18px] text-cream leading-snug">{p.headline}</p>
        </section>
      )}
      {p.highlights.length > 0 && (
        <section>
          <Eyebrow tone="muted">Highlights ({p.highlights.length})</Eyebrow>
          <ul className="mt-2 space-y-1.5 font-body text-[12.5px] text-cream-dim list-disc list-inside marker:text-coral-400">
            {p.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </section>
      )}
      {(p.crexiUrl || p.loopnetUrl || p.publishToWebsite != null || p.images.length > 0) && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
          <Fact label="Images on file" value={p.images.length > 0 ? p.images.length.toString() : null} />
          <Fact
            label="On website"
            value={p.publishToWebsite == null ? null : p.publishToWebsite ? "yes" : "no"}
            tone={p.publishToWebsite ? "teal" : "default"}
          />
          {p.crexiUrl && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">CREXi</div>
              <a
                href={p.crexiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block font-heading text-[12px] text-teal-300 hover:text-teal-200 underline-offset-2 hover:underline truncate"
              >
                view listing →
              </a>
            </div>
          )}
          {p.loopnetUrl && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">LoopNet</div>
              <a
                href={p.loopnetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-block font-heading text-[12px] text-teal-300 hover:text-teal-200 underline-offset-2 hover:underline truncate"
              >
                view listing →
              </a>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Hotel-specific panel — rendered only when asset_type=hospitality.
// Captures brand/class/key-count — facts every hotel buyer asks about
// in the first 30 seconds of a call.
function HotelIntelPanel({ p }: { p: PropertyDetail }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3">
      <Fact label="Flag / brand" value={p.hotelBrand} tone={p.hotelBrand ? "coral" : "default"} />
      <Fact label="Class" value={p.hotelClass} />
      <Fact label="Keys" value={p.rooms?.toLocaleString() ?? null} />
      <Fact label="Year built" value={p.yearBuilt?.toString() ?? null} />
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

// ── Document inventory editor ───────────────────────────────────────────
// List of marketing / due-diligence documents available for THIS property,
// each tagged with a disclosure tier. The AI references this list when
// buyers ask for specific documents so it knows what's releasable and
// what needs to be gated.
const TIER_LABELS: Record<DocumentInventoryItem["tier"], { label: string; tone: string; help: string }> = {
  public: { label: "Public", tone: "border-teal-400/30 bg-teal-400/[0.06] text-teal-300", help: "Share freely (flyer, asking price, building basics)" },
  qualified: { label: "Qualified", tone: "border-amber/40 bg-amber/[0.06] text-amber", help: "After light buyer qualification (full OM, rent roll summary)" },
  nda: { label: "NDA", tone: "border-coral-400/40 bg-coral-400/[0.06] text-coral-300", help: "Requires NDA + buyer review (full leases, op statements)" },
  restricted: { label: "Restricted", tone: "border-coral-400/60 bg-coral-400/[0.12] text-coral-300", help: "Never share without explicit broker approval" },
};

function DocumentInventoryEditor({ propertyId, initial }: { propertyId: string; initial: DocumentInventoryItem[] }) {
  const [items, setItems] = useState<DocumentInventoryItem[]>(initial);
  const [draftName, setDraftName] = useState("");
  const [draftTier, setDraftTier] = useState<DocumentInventoryItem["tier"]>("public");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addItem() {
    const n = draftName.trim();
    if (!n) return;
    setItems([...items, { name: n, tier: draftTier }]);
    setDraftName("");
  }
  function removeItem(i: number) {
    setItems(items.filter((_, idx) => idx !== i));
  }
  function setItemTier(i: number, tier: DocumentInventoryItem["tier"]) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, tier } : it)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_inventory: items }),
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
    <div className="space-y-3">
      <p className="font-body text-[12px] text-cream-subtle leading-relaxed">
        Tell the AI what documents exist for this listing and what tier of disclosure each one requires.
        When a buyer asks for &ldquo;the rent roll&rdquo; or &ldquo;environmental reports&rdquo;, the AI will know
        whether we have it and what to ask for before sending.
      </p>

      {/* Existing items */}
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((it, i) => {
            const tone = TIER_LABELS[it.tier].tone;
            return (
              <li key={i} className="flex items-center gap-2 rounded border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
                <span className="flex-1 font-body text-[12.5px] text-cream">{it.name}</span>
                <select
                  value={it.tier}
                  onChange={(e) => setItemTier(i, e.target.value as DocumentInventoryItem["tier"])}
                  className={`shrink-0 px-2 py-1 rounded border font-mono text-[9.5px] uppercase tracking-eyebrow ${tone}`}
                >
                  {(Object.keys(TIER_LABELS) as DocumentInventoryItem["tier"][]).map((t) => (
                    <option key={t} value={t}>{TIER_LABELS[t].label}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeItem(i)}
                  className="shrink-0 font-mono text-[11px] text-cream-subtle hover:text-coral-300"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add new */}
      <div className="flex gap-1.5 items-stretch">
        <input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="e.g. Full OM, Rent roll, Environmental Phase I"
          className="flex-1 px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-teal-400/40 focus:outline-none font-body text-base lg:text-[12.5px] text-cream placeholder:text-cream-subtle"
        />
        <select
          value={draftTier}
          onChange={(e) => setDraftTier(e.target.value as DocumentInventoryItem["tier"])}
          className="shrink-0 px-2 py-2 rounded border border-white/[0.08] bg-white/[0.02] font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim"
        >
          {(Object.keys(TIER_LABELS) as DocumentInventoryItem["tier"][]).map((t) => (
            <option key={t} value={t}>{TIER_LABELS[t].label}</option>
          ))}
        </select>
        <button
          onClick={addItem}
          disabled={!draftName.trim()}
          className="shrink-0 px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] disabled:opacity-40 font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream"
        >
          + Add
        </button>
      </div>

      {/* Tier legend */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2 border-t border-white/[0.05]">
        {(Object.keys(TIER_LABELS) as DocumentInventoryItem["tier"][]).map((t) => (
          <div key={t} className="flex items-start gap-2 font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            <span className={`shrink-0 px-1.5 py-0.5 rounded border ${TIER_LABELS[t].tone}`}>{TIER_LABELS[t].label}</span>
            <span className="normal-case font-body text-[11px] text-cream-subtle">{TIER_LABELS[t].help}</span>
          </div>
        ))}
      </div>

      {/* Save bar */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
          {error && <span className="text-coral-300">Save failed: {error}</span>}
          {!error && savedAt && <span className="text-teal-300">Saved · live now</span>}
          {!error && !savedAt && <span>{items.length} document{items.length === 1 ? "" : "s"} on file</span>}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.18] disabled:opacity-40 font-mono text-[10px] uppercase tracking-eyebrow text-teal-300"
        >
          {saving ? "Saving…" : "Save inventory"}
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
      {/* Owner — up to three identities can be on file:
            1. True Owner (CoStar LLC unmask) — the entity that actually controls
            2. Recorded Owner (CoStar mailing record) — what shows on tax bill
            3. County-recorded owner — the deed record (most authoritative) */}
      {(p.trueOwnerName || p.ownerNameRaw || p.recordedOwnerName) && (
        <section>
          <Eyebrow tone="muted">Owner</Eyebrow>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                label="Recorded Owner (CoStar)"
                name={p.ownerNameRaw}
                contactName={p.ownerContactName}
                phone={p.ownerPhone}
                address={p.ownerMailingAddress}
                city={p.ownerMailingCity}
                state={p.ownerMailingState}
                zip={p.ownerMailingZip}
              />
            )}
            {p.recordedOwnerName &&
              p.recordedOwnerName !== p.trueOwnerName &&
              p.recordedOwnerName !== p.ownerNameRaw && (
                <OwnerCard
                  label="Recorded Owner (county deed)"
                  name={p.recordedOwnerName}
                  contactName={null}
                  phone={p.recordedOwnerPhone}
                  address={p.recordedOwnerAddress}
                  city={null}
                  state={null}
                  zip={null}
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
            <Fact label="Originator" value={p.loanOriginator} />
            <Fact label="Rate" value={p.loanInterestRate != null ? `${p.loanInterestRate}%` : null} />
            <Fact label="Rate type" value={p.loanInterestRateType} />
            <Fact label="Loan type" value={p.loanType} />
            <Fact label="Collateral type" value={p.loanCollateralType} />
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

      {/* Service contacts (property manager + listing brokers on CoStar's record).
          Company names + property-manager mailing address surface here so the
          marketing engine can reference current representation when generating
          OM / flyer copy. */}
      {(p.propertyManagerName || p.salesContactName || p.leasingContactName) && (
        <section>
          <Eyebrow tone="muted">Service contacts</Eyebrow>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {p.propertyManagerName && (
              <ContactCard
                label="Property Mgr"
                name={p.propertyManagerName}
                phone={p.propertyManagerPhone}
                sub={p.propertyManagerAddress}
              />
            )}
            {(p.salesContactName || p.salesCompanyName) && (
              <ContactCard
                label="Sales Contact"
                name={p.salesContactName ?? p.salesCompanyName ?? ""}
                phone={p.salesContactPhone}
                sub={p.salesContactName && p.salesCompanyName ? p.salesCompanyName : null}
              />
            )}
            {(p.leasingContactName || p.leasingCompanyName) && (
              <ContactCard
                label="Leasing Contact"
                name={p.leasingContactName ?? p.leasingCompanyName ?? ""}
                phone={p.leasingContactPhone}
                sub={p.leasingContactName && p.leasingCompanyName ? p.leasingCompanyName : null}
              />
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

function ContactCard({
  label,
  name,
  phone,
  sub,
}: {
  label: string;
  name: string;
  phone?: string | null;
  /** Optional secondary line — company name, mailing address, etc. */
  sub?: string | null;
}) {
  return (
    <div className="rounded border border-white/[0.05] bg-white/[0.02] p-3">
      <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-heading text-[12.5px] text-cream font-semibold truncate">{name}</div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-cream-subtle truncate">{sub}</div>}
      {phone && <div className="mt-0.5 font-mono text-[10.5px] text-teal-300">📞 {phone}</div>}
    </div>
  );
}

function Fact({ label, value, tone = "default" }: { label: string; value: string | null | undefined; tone?: "default" | "coral" | "teal" }) {
  const color =
    tone === "coral" ? "text-coral-300" : tone === "teal" ? "text-teal-300" : "text-cream";
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className={`mt-0.5 font-heading text-[13px] ${color}`}>
        {value ?? <span className="text-cream-subtle">—</span>}
      </div>
    </div>
  );
}
