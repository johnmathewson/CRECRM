"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Panel, { IconBtn } from "./panel";
import { createClient } from "@/lib/supabase/client";
import AddListingWizard from "./add-listing-wizard";
import CompAnalysisModal from "./comp-analysis-modal";
import ShareWithOwnerModal from "./share-with-owner-modal";
import CreateDealModal from "./create-deal-modal";
import OMExtractModal from "./om-extract-modal";

// ── Types ──────────────────────────────────────────────────
interface Property {
  id: string;
  name: string;
  headline?: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  asset_type: string | null;
  transaction_type?: string | null;
  status: string | null;
  asking_price: number | null;
  lease_rate: number | null;
  sqft: number | null;
  acreage: number | null;
  year_built: number | null;
  parking_spaces?: number | null;
  parking_ratio?: string | null;
  zoning?: string | null;
  noi?: number | null;
  cap_rate?: number | null;
  price_per_sf?: number | null;
  occupancy_pct?: number | null;
  description?: string | null;
  highlights?: string[] | null;
  crexi_url?: string | null;
  publish_to_website?: boolean | null;
  your_role: string | null;
  notes: string | null;
  images?: any[] | null;
  slug?: string | null;
  owner?: { full_name: string } | null;
  deals?: { id: string; deal_name: string; deal_type: string; price: number; is_closed: boolean }[];
  // Unified pipeline (migration 0003) — replaces the old `status` field as the
  // canonical stage. Allowed values: Lead | LOI | Listing | Under Contract | Closed | Dead
  pipeline_stage?: PipelineStage | null;
  agreed_price?: number | null;
  commission_pct?: number | null;
  estimated_commission?: number | null;
  probability_pct?: number | null;
  weighted_commission?: number | null;
  expected_close?: string | null;
  actual_close?: string | null;
}

type PipelineStage = "Lead" | "LOI" | "Listing" | "Under Contract" | "Closed" | "Dead";

const PIPELINE_STAGES: PipelineStage[] = ["Lead", "LOI", "Listing", "Under Contract", "Closed", "Dead"];

// Coral-on-charcoal palette mapped to each stage. Stage colors mirror the
// /deals kanban so the visual language is consistent across the app.
const stageColors: Record<PipelineStage, { bg: string; t: string }> = {
  Lead:             { bg: "rgba(242,201,76,0.20)", t: "#F2C94C" }, // amber
  LOI:              { bg: "rgba(224,122,95,0.18)", t: "#E07A5F" }, // coral light
  Listing:          { bg: "rgba(224,122,95,0.30)", t: "#E07A5F" }, // coral active
  "Under Contract": { bg: "rgba(78,205,196,0.22)", t: "#4ECDC4" }, // teal
  Closed:           { bg: "rgba(107,203,119,0.22)", t: "#6BCB77" }, // green
  Dead:             { bg: "rgba(255,255,255,0.06)", t: "rgba(240,237,228,0.45)" }, // muted
};

// ── Colors ─────────────────────────────────────────────────
const C = {
  coral: "#E07A5F", teal: "#4ECDC4", green: "#6BCB77", amber: "#F2C94C", red: "#E74C3C",
  coralM: "rgba(224,122,95,0.22)", tealM: "rgba(78,205,196,0.22)",
  greenM: "rgba(107,203,119,0.20)", amberM: "rgba(242,201,76,0.20)",
};

const fmt = (n: number | null) => {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};

const fmtNum = (n: number | null) => n ? n.toLocaleString() : "—";

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { bg: string; t: string; label: string }> = {
    listed: { bg: C.coralM, t: C.coral, label: "Listed" },
    pre_listing: { bg: C.amberM, t: C.amber, label: "Pre-Listing" },
    under_contract: { bg: C.tealM, t: C.teal, label: "Under Contract" },
    sold: { bg: C.greenM, t: C.green, label: "Sold" },
    leased: { bg: C.greenM, t: C.green, label: "Leased" },
    for_lease: { bg: C.tealM, t: C.teal, label: "For Lease" },
    off_market: { bg: "rgba(255,255,255,0.08)", t: "rgba(240,237,228,0.5)", label: "Off Market" },
    idea: { bg: "rgba(255,255,255,0.08)", t: "rgba(240,237,228,0.4)", label: "Idea" },
  };
  const c = map[(status || "").toLowerCase()] || { bg: "rgba(255,255,255,0.08)", t: "rgba(240,237,228,0.4)", label: status || "—" };
  return (
    <span className="px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap" style={{ borderRadius: 4, background: c.bg, color: c.t }}>
      {c.label}
    </span>
  );
}

function AssetBadge({ type }: { type: string | null }) {
  const iconMap: Record<string, string> = {
    retail: "🏪", office: "🏢", industrial: "🏭", multifamily: "🏠",
    hotel: "🏨", land: "🌿", mixed_use: "🏗️", "mixed-use": "🏗️",
    restaurant: "🍽️", medical: "🏥", flex: "⚙️",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[12px]">{iconMap[(type || "").toLowerCase()] || "🏢"}</span>
      <span className="text-xs capitalize text-cream-muted">{(type || "—").replace(/_/g, " ")}</span>
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function PropertiesContent() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [selected, setSelected] = useState<Property | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "grid">("table");
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCompAnalysis, setShowCompAnalysis] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [togglingPublish, setTogglingPublish] = useState(false);
  const [sharingProperty, setSharingProperty] = useState<Property | null>(null);
  const [createDealForProperty, setCreateDealForProperty] = useState<string | null>(null);
  const [omForProperty, setOmForProperty] = useState<Property | null>(null);

  // Router refs for cross-page navigation (deals ↔ properties).
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const load = useCallback(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("properties")
        .select(`
          id, name, headline, slug, address, city, state, zip,
          asset_type, transaction_type, status,
          pipeline_stage,
          asking_price, lease_rate, sqft, acreage, year_built,
          parking_spaces, parking_ratio, zoning,
          noi, cap_rate, price_per_sf, occupancy_pct,
          agreed_price, commission_pct, estimated_commission,
          probability_pct, weighted_commission,
          expected_close, actual_close,
          description, highlights, crexi_url, images,
          publish_to_website,
          your_role, notes,
          owner:contacts!properties_owner_contact_id_fkey(full_name),
          deals(id, deal_name, deal_type, price, is_closed)
        `)
        .order("name");

      setProperties((data as any) || []);
      setLoading(false);
  }, []);

  // Move a property through the unified pipeline (Lead → LOI → Listing →
  // Under Contract → Closed | Dead) without leaving the detail panel.
  // Called from the stage pill bar in the property detail panel.
  const [updatingStage, setUpdatingStage] = useState(false);
  async function setPipelineStage(p: Property, next: PipelineStage) {
    if (p.pipeline_stage === next) return;
    setUpdatingStage(true);
    try {
      const res = await fetch(`/api/properties/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_stage: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Stage update failed: ${err.error || res.status}`);
        return;
      }
      const data = await res.json();
      const updated = { ...p, pipeline_stage: data.property?.pipeline_stage ?? next } as Property;
      setProperties((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
      setSelected(updated);
    } finally {
      setUpdatingStage(false);
    }
  }

  // Toggle publish_to_website without leaving the detail panel.
  async function togglePublish(p: Property) {
    setTogglingPublish(true);
    try {
      const next = !p.publish_to_website;
      const res = await fetch(`/api/properties/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish_to_website: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(`Toggle failed: ${err.error || res.status}`);
        return;
      }
      // Optimistic local update + sync from response
      const data = await res.json();
      const updated = { ...p, publish_to_website: data.property?.publish_to_website ?? next };
      setProperties(prev => prev.map(x => x.id === p.id ? updated : x));
      setSelected(updated);
    } finally {
      setTogglingPublish(false);
    }
  }

  useEffect(() => { load(); }, [load]);

  // Deep-link focus: open ?focus=<property_id> in the detail panel on load.
  // Triggered by clicks from /deals when a user wants to see the property
  // record behind a deal, or from anywhere else that wants a one-click handoff.
  useEffect(() => {
    if (loading || properties.length === 0) return;
    const focusId = searchParams.get("focus");
    if (!focusId) return;
    const target = properties.find((p) => p.id === focusId);
    if (target) {
      setSelected(target);
      router.replace(pathname, { scroll: false });
    }
  }, [loading, properties, searchParams, router, pathname]);

  // Filter + search
  const filtered = properties.filter((p) => {
    if (filter !== "all" && p.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        (p.address || "").toLowerCase().includes(q) ||
        (p.city || "").toLowerCase().includes(q) ||
        (p.asset_type || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const totalValue = properties.reduce((s, p) => s + (p.asking_price || 0), 0);
  const totalSF = properties.reduce((s, p) => s + (p.sqft || 0), 0);
  const statusCounts: Record<string, number> = { all: properties.length };
  properties.forEach((p) => {
    const s = p.status || "unknown";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  // Asset type breakdown
  const assetCounts: Record<string, number> = {};
  properties.forEach((p) => {
    const t = p.asset_type || "other";
    assetCounts[t] = (assetCounts[t] || 0) + 1;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-cream-muted text-sm animate-pulse">Loading properties...</div>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-end mb-[18px]">
        <div>
          <h1 className="text-2xl font-bold m-0 tracking-tight">Properties</h1>
          <p className="mt-1 text-cream-muted text-[13px]">
            <span className="text-coral font-semibold">{properties.length} properties</span>
            {" · "}{fmtNum(totalSF)} SF · {fmt(totalValue)} total asking
          </p>
        </div>
        <div className="flex gap-2">
          <div className="glass-inner flex overflow-hidden" style={{ borderRadius: 5 }}>
            <button
              onClick={() => setView("table")}
              className={`px-3 py-1.5 text-xs border-none cursor-pointer ${view === "table" ? "text-coral font-semibold" : "text-cream-subtle"}`}
              style={{ background: view === "table" ? C.coralM : "transparent" }}
            >
              ☰ Table
            </button>
            <button
              onClick={() => setView("grid")}
              className={`px-3 py-1.5 text-xs border-none cursor-pointer ${view === "grid" ? "text-coral font-semibold" : "text-cream-subtle"}`}
              style={{ background: view === "grid" ? C.coralM : "transparent" }}
            >
              ⊞ Grid
            </button>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-1.5 border-none cursor-pointer text-xs font-semibold text-white"
            style={{
              borderRadius: 5,
              background: "linear-gradient(135deg, #E07A5F, #E07A5FCC)",
              boxShadow: "0 3px 16px rgba(224,122,95,0.35)",
            }}
          >
            + New Lead
          </button>
        </div>
      </div>

      <AddListingWizard
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={load}
        organizationId="a0000000-0000-0000-0000-000000000001"
      />
      <AddListingWizard
        open={!!editingProperty}
        onClose={() => setEditingProperty(null)}
        onCreated={(p) => {
          load();
          setSelected(p as Property);
        }}
        organizationId="a0000000-0000-0000-0000-000000000001"
        editProperty={editingProperty}
      />
      {sharingProperty && (
        <ShareWithOwnerModal
          open={!!sharingProperty}
          onClose={() => setSharingProperty(null)}
          propertyId={sharingProperty.id}
          propertyName={sharingProperty.headline || sharingProperty.name}
          ownerContactId={(sharingProperty.owner as any)?.id}
          ownerName={(sharingProperty.owner as any)?.full_name}
        />
      )}
      <CompAnalysisModal
        open={showCompAnalysis}
        onClose={() => setShowCompAnalysis(false)}
        property={selected}
      />

      {/* Create-deal modal — opened from a property's Quick Actions; prefills
          the property dropdown so the deal lands on this asset automatically. */}
      <CreateDealModal
        open={!!createDealForProperty}
        onClose={() => setCreateDealForProperty(null)}
        prefillPropertyId={createDealForProperty || undefined}
        onCreated={() => {
          setCreateDealForProperty(null);
          // Refresh so the new deal appears in this property's deals list.
          load();
        }}
      />

      {/* OM Extract modal — upload a PDF/DOCX, Claude extracts CRE fields,
          user reviews diff, applies selected fields back to this property. */}
      {omForProperty && (
        <OMExtractModal
          open={!!omForProperty}
          onClose={() => setOmForProperty(null)}
          propertyId={omForProperty.id}
          propertyName={omForProperty.name}
          onApplied={() => {
            // Refresh so the property panel shows the newly-applied OM fields.
            load();
          }}
        />
      )}

      {/* Status tabs + search */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {Object.entries(statusCounts).map(([key, count]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-[11.5px] font-medium border-none cursor-pointer transition-all ${
              filter === key ? "text-coral font-semibold" : "text-cream-subtle hover:text-cream-muted"
            }`}
            style={{
              borderRadius: 5,
              background: filter === key ? C.coralM : "rgba(255,255,255,0.03)",
              border: `1px solid ${filter === key ? "rgba(224,122,95,0.2)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <span className="capitalize">{key.replace(/_/g, " ")}</span>
            <span className="ml-1.5 opacity-50">{count}</span>
          </button>
        ))}
        <div className="flex-1" />
        <div
          className="flex items-center gap-2 px-3 py-1.5 w-64"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 5,
          }}
        >
          <span className="opacity-35 text-xs">🔍</span>
          <input
            placeholder="Search properties..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent border-none outline-none text-cream text-xs w-full font-sans"
          />
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: selected ? "1fr 400px" : "1fr" }}>
        {/* Table or Grid */}
        {view === "table" ? (
          <Panel title={`${filtered.length} Properties`} actions={
            <div className="flex gap-1"><IconBtn>↻</IconBtn><IconBtn>↓</IconBtn><IconBtn>⋯</IconBtn></div>
          }>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 3px" }}>
                <thead>
                  <tr className="text-[10px] text-cream-subtle uppercase tracking-wider">
                    {["Property", "Type", "Status", "SF", "Asking", "Role", "Owner"].map((h, i) => (
                      <th key={h} className={`px-2.5 pb-2 font-medium ${i >= 3 && i <= 4 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const owner = p.owner as any;
                    const isSelected = selected?.id === p.id;
                    const bg = isSelected ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)";
                    return (
                      <tr key={p.id} className="cursor-pointer" onClick={() => setSelected(isSelected ? null : p)}>
                        <td className="px-2.5 py-2.5 text-[12.5px] font-medium" style={{ borderRadius: "4px 0 0 4px", background: bg }}>
                          {p.name}
                          {p.city && <div className="text-[10px] text-cream-subtle mt-0.5">{p.city}, {p.state}</div>}
                        </td>
                        <td className="px-2.5 py-2.5" style={{ background: bg }}>
                          <AssetBadge type={p.asset_type} />
                        </td>
                        <td className="px-2.5 py-2.5" style={{ background: bg }}>
                          <StatusBadge status={p.status} />
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs text-cream-muted tnum" style={{ background: bg }}>
                          {fmtNum(p.sqft)}
                        </td>
                        <td className="px-2.5 py-2.5 text-right text-xs font-semibold tnum" style={{ color: C.coral, background: bg }}>
                          {fmt(p.asking_price)}
                        </td>
                        <td className="px-2.5 py-2.5 text-xs text-cream-muted capitalize" style={{ background: bg }}>
                          {(p.your_role || "—").replace(/_/g, " ")}
                        </td>
                        <td className="px-2.5 py-2.5 text-xs text-cream-muted" style={{ borderRadius: "0 4px 4px 0", background: bg }}>
                          {owner?.full_name || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {filtered.map((p) => {
              const isSelected = selected?.id === p.id;
              return (
                <div
                  key={p.id}
                  className="glass cursor-pointer transition-all hover:bg-[rgba(255,255,255,0.06)]"
                  style={{
                    borderColor: isSelected ? "rgba(224,122,95,0.3)" : undefined,
                    boxShadow: isSelected ? "0 0 20px rgba(224,122,95,0.15)" : undefined,
                  }}
                  onClick={() => setSelected(isSelected ? null : p)}
                >
                  {/* Card header bar */}
                  <div className="panel-header">
                    <AssetBadge type={p.asset_type} />
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="p-4">
                    <div className="text-sm font-bold mb-0.5">{p.name}</div>
                    <div className="text-[11px] text-cream-subtle mb-3">
                      {[p.address, p.city, p.state].filter(Boolean).join(", ")}
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-[10px] text-cream-subtle uppercase tracking-wider">Asking</div>
                        <div className="text-lg font-bold tnum" style={{ color: C.coral }}>{fmt(p.asking_price)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-cream-subtle uppercase tracking-wider">Size</div>
                        <div className="text-sm font-semibold tnum">{fmtNum(p.sqft)} SF</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Detail sidebar */}
        {selected && (
          <div className="flex flex-col gap-4">
            <Panel title="Property Detail" actions={
              <div className="flex gap-1"><IconBtn onClick={() => setSelected(null)}>✕</IconBtn></div>
            }>
              <div className="mb-3">
                <div className="text-lg font-bold">{selected.name}</div>
                {selected.headline && (
                  <div className="text-xs italic mt-0.5" style={{ color: C.coral }}>
                    {selected.headline}
                  </div>
                )}
                <div className="text-xs text-cream-muted mt-0.5">
                  {[selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(", ")}
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                <AssetBadge type={selected.asset_type} />
                <StatusBadge status={selected.status} />
              </div>

              {/* Pipeline stage selector — clickable pills that advance the
                  property through Lead → LOI → Listing → Under Contract →
                  Closed | Dead. Single source of truth for stage; matches the
                  /deals kanban columns visually. */}
              <div className="mb-4">
                <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1.5">Pipeline Stage</div>
                <div className="flex gap-1 flex-wrap">
                  {PIPELINE_STAGES.map((stage) => {
                    const active = (selected.pipeline_stage || "Lead") === stage;
                    const sc = stageColors[stage];
                    return (
                      <button
                        key={stage}
                        onClick={() => setPipelineStage(selected, stage)}
                        disabled={updatingStage}
                        className="text-[10.5px] px-2.5 py-1 cursor-pointer border-none transition-all"
                        style={{
                          borderRadius: 4,
                          background: active ? sc.bg : "rgba(255,255,255,0.03)",
                          color: active ? sc.t : "rgba(240,237,228,0.5)",
                          fontWeight: active ? 600 : 400,
                          opacity: updatingStage ? 0.5 : 1,
                        }}
                      >
                        {stage}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Publish toggle — prominent. One click flips it on/off. */}
              <button
                onClick={() => togglePublish(selected)}
                disabled={togglingPublish}
                className="w-full flex items-center gap-3 px-3.5 py-3 mb-4 cursor-pointer border-none transition-all"
                style={{
                  borderRadius: 6,
                  background: selected.publish_to_website
                    ? "linear-gradient(135deg, rgba(107,203,119,0.18), rgba(107,203,119,0.10))"
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${selected.publish_to_website ? "rgba(107,203,119,0.45)" : "rgba(255,255,255,0.08)"}`,
                  opacity: togglingPublish ? 0.5 : 1,
                }}
              >
                <div
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 6,
                    background: selected.publish_to_website ? "rgba(107,203,119,0.25)" : "rgba(255,255,255,0.05)",
                    fontSize: 16,
                  }}
                >
                  {selected.publish_to_website ? "🌐" : "👁️"}
                </div>
                <div className="flex-1 text-left">
                  <div
                    className="text-[11px] font-bold tracking-wider uppercase"
                    style={{ color: selected.publish_to_website ? C.green : "rgba(240,237,228,0.55)" }}
                  >
                    {selected.publish_to_website ? "Live on Website" : "Hidden from Website"}
                  </div>
                  <div className="text-[10.5px] text-cream-subtle mt-0.5">
                    {selected.publish_to_website
                      ? "Visible on stewardshipcre.com — click to take down"
                      : "Not visible publicly — click to publish"}
                  </div>
                </div>
                <div
                  className="flex-shrink-0 relative"
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 10,
                    background: selected.publish_to_website ? C.green : "rgba(255,255,255,0.12)",
                    transition: "background 0.18s",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      left: selected.publish_to_website ? 18 : 2,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "white",
                      transition: "left 0.18s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    }}
                  />
                </div>
              </button>

              {/* Edit Listing + Share with Owner row */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => setEditingProperty(selected)}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 cursor-pointer border-none transition-all hover:bg-[rgba(224,122,95,0.08)]"
                  style={{
                    borderRadius: 6,
                    background: "rgba(224,122,95,0.06)",
                    border: "1px solid rgba(224,122,95,0.28)",
                  }}
                >
                  <span className="text-[13px]">✏️</span>
                  <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: C.coral }}>
                    Edit
                  </span>
                </button>
                <button
                  onClick={() => setSharingProperty(selected)}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 cursor-pointer border-none transition-all hover:bg-[rgba(78,205,196,0.08)]"
                  style={{
                    borderRadius: 6,
                    background: "rgba(78,205,196,0.05)",
                    border: "1px solid rgba(78,205,196,0.28)",
                  }}
                >
                  <span className="text-[13px]">🔗</span>
                  <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: C.teal }}>
                    Share with owner
                  </span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: "Asking Price", value: fmt(selected.asking_price), accent: true },
                  { label: "Lease Rate", value: selected.lease_rate ? `$${selected.lease_rate}/SF` : "—" },
                  { label: "Square Feet", value: fmtNum(selected.sqft) },
                  { label: "Acreage", value: selected.acreage ? `${selected.acreage} ac` : "—" },
                  { label: "Year Built", value: selected.year_built ? String(selected.year_built) : "—" },
                  { label: "Your Role", value: (selected.your_role || "—").replace(/_/g, " ") },
                ].map((row) => (
                  <div key={row.label} className="glass-inner px-3 py-2.5">
                    <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">{row.label}</div>
                    <div className={`text-sm font-semibold tnum capitalize ${row.accent ? "" : "text-cream"}`} style={row.accent ? { color: C.coral } : undefined}>
                      {row.value}
                    </div>
                  </div>
                ))}
              </div>

              {(selected.owner as any)?.full_name && (
                <div className="glass-inner px-3 py-2.5 mb-3">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Owner</div>
                  <div className="text-xs font-semibold">{(selected.owner as any).full_name}</div>
                </div>
              )}

              {selected.notes && (
                <div className="glass-inner px-3 py-2.5">
                  <div className="text-[9.5px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Notes</div>
                  <div className="text-xs text-cream-muted leading-relaxed">{selected.notes}</div>
                </div>
              )}
            </Panel>

            {/* Deals on this property */}
            {(selected.deals || []).length > 0 && (
              <Panel title="Deals" actions={<IconBtn>↻</IconBtn>}>
                <div className="flex flex-col gap-1.5">
                  {(selected.deals || []).map((d: any) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => router.push(`/deals?focus=${d.id}`)}
                      className="glass-inner flex justify-between items-center px-3 py-2 cursor-pointer hover:brightness-125 transition-all border-none w-full text-left"
                      title="Open in Deals"
                    >
                      <div>
                        <span className="text-xs font-medium">{d.deal_name}</span>
                        <span className="ml-2 px-1.5 py-0.5 text-[9.5px] font-semibold" style={{
                          borderRadius: 4,
                          background: d.deal_type === "sale" ? C.coralM : C.tealM,
                          color: d.deal_type === "sale" ? C.coral : C.teal,
                        }}>
                          {d.deal_type}
                        </span>
                      </div>
                      <span className="text-xs font-bold tnum" style={{ color: d.is_closed ? C.green : C.coral }}>
                        {d.price > 0 ? fmt(d.price) : "—"}
                      </span>
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            {/* Quick actions */}
            <Panel title="Quick Actions" actions={<IconBtn>⋯</IconBtn>}>
              <div className="flex flex-col gap-1.5">
                {[
                  { icon: "🔐", label: "Vault docs", desc: "Manage gated documents (public / tenant / buyer)", href: `/admin/vault/${selected.id}` },
                  { icon: "📥", label: "Upload OM", desc: "Drop a PDF/DOCX, auto-fill missing fields with cross-reference review" },
                  { icon: "📋", label: "Create OM", desc: "Generate an offering memorandum" },
                  { icon: "📊", label: "Run comps", desc: "Pull sale & lease comparables" },
                  { icon: "🤝", label: "Create deal", desc: "Start a new deal on this property" },
                ].map((a) => {
                  const inner = (
                    <>
                      <span className="text-[13px]">{a.icon}</span>
                      <div>
                        <div className="text-xs font-medium text-cream">{a.label}</div>
                        <div className="text-[10px] text-cream-subtle">{a.desc}</div>
                      </div>
                    </>
                  );
                  const cls = "glass-inner flex items-center gap-2.5 px-3 py-2.5 text-left w-full cursor-pointer border-none transition-all hover:bg-[rgba(255,255,255,0.05)] no-underline";
                  const style = { background: "rgba(255,255,255,0.02)" } as const;
                  if ((a as any).href) {
                    return (
                      <a key={a.label} href={(a as any).href} className={cls} style={style}>
                        {inner}
                      </a>
                    );
                  }
                  return (
                    <button
                      key={a.label}
                      onClick={() => {
                        if (a.label === "Run comps") setShowCompAnalysis(true);
                        else if (a.label === "Create deal") setCreateDealForProperty(selected.id);
                        else if (a.label === "Upload OM") setOmForProperty(selected);
                      }}
                      className={cls}
                      style={style}
                    >
                      {inner}
                    </button>
                  );
                })}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </>
  );
}
