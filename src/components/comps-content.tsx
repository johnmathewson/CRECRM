"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Panel, { IconBtn } from "./panel";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────
interface SaleComp {
  id: string;
  address: string;
  city: string;
  state: string;
  asset_type: string | null;
  sale_date: string | null;
  sale_price: number | null;
  price_per_sqft: number | null;
  cap_rate: number | null;
  sqft: number | null;
  acreage: number | null;
  year_built: number | null;
  buyer: string | null;
  seller: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  data_source: string | null;
  created_at: string;
}

interface LeaseComp {
  id: string;
  address: string;
  city: string;
  state: string;
  asset_type: string | null;
  tenant_name: string | null;
  lease_date: string | null;
  rent_per_sqft: number | null;
  sqft: number | null;
  lease_type: string | null;
  term_months: number | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  data_source: string | null;
  created_at: string;
}

// ── Colors ─────────────────────────────────────────────────
const C = {
  coral: "#E07A5F", teal: "#4ECDC4", green: "#6BCB77", amber: "#F2C94C", red: "#E74C3C",
  coralM: "rgba(224,122,95,0.22)", tealM: "rgba(78,205,196,0.22)",
  greenM: "rgba(107,203,119,0.20)", amberM: "rgba(242,201,76,0.20)",
};

const fmt = (n: number | null | undefined) => {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};

const fmtPsf = (n: number | null | undefined) => (n ? `$${n.toFixed(2)}` : "—");
const fmtCap = (n: number | null | undefined) => (n ? `${(n * 100).toFixed(2)}%` : "—");
const fmtNum = (n: number | null | undefined) => (n ? n.toLocaleString() : "—");
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

function AssetBadge({ type }: { type: string | null }) {
  const iconMap: Record<string, string> = {
    retail: "🏪", office: "🏢", industrial: "🏭", multifamily: "🏠",
    hotel: "🏨", land: "🌿", flex: "⚙️", medical: "🏥", specialty: "🎯",
    hospitality: "🏨",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[12px]">{iconMap[(type || "").toLowerCase()] || "🏢"}</span>
      <span className="text-xs capitalize text-cream-muted">{(type || "—").replace(/_/g, " ")}</span>
    </span>
  );
}

function StatusDot({ notes }: { notes: string | null }) {
  const isSold = notes?.includes("Status: Sold");
  const isActive = notes?.includes("Status: Active");
  const isUC = notes?.includes("Status: Under Contract");
  const color = isSold ? C.green : isActive ? C.coral : isUC ? C.amber : "rgba(255,255,255,0.3)";
  const label = isSold ? "Sold" : isActive ? "Active" : isUC ? "UC" : "—";
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-[11px]" style={{ color }}>{label}</span>
    </span>
  );
}

// ── Main ──────────────────────────────────────────────────
export default function CompsContent() {
  const [saleComps, setSaleComps] = useState<SaleComp[]>([]);
  const [leaseComps, setLeaseComps] = useState<LeaseComp[]>([]);
  const [tab, setTab] = useState<"sale" | "lease">("sale");
  const [filter, setFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SaleComp | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const supabase = createClient();

    // Use RPC function to bypass PostgREST 1000-row default limit
    const [{ data: sales }, { data: leases }] = await Promise.all([
      supabase.rpc("get_all_sale_comps"),
      supabase
        .from("lease_comps")
        .select("*")
        .order("lease_date", { ascending: false, nullsFirst: false })
        .limit(5000),
    ]);

    setSaleComps((sales as SaleComp[]) || []);
    setLeaseComps((leases as LeaseComp[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive city list from sale comps
  const cities = Array.from(new Set(saleComps.map((c) => c.city).filter(Boolean))).sort();
  const assetTypes = Array.from(new Set(saleComps.map((c) => c.asset_type).filter(Boolean) as string[])).sort();

  // Filter sale comps
  const filteredSales = saleComps.filter((c) => {
    if (filter !== "all" && c.asset_type !== filter) return false;
    if (cityFilter !== "all" && c.city !== cityFilter) return false;
    if (statusFilter !== "all") {
      const status = c.notes?.includes("Status: Sold") ? "sold" : c.notes?.includes("Status: Active") ? "active" : c.notes?.includes("Status: Under Contract") ? "uc" : "other";
      if (statusFilter !== status) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        c.address.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.notes || "").toLowerCase().includes(q) ||
        (c.buyer || "").toLowerCase().includes(q) ||
        (c.seller || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const totalSales = saleComps.length;
  const totalLeases = leaseComps.length;
  const cityCounts = saleComps.reduce((acc, c) => { acc[c.city] = (acc[c.city] || 0) + 1; return acc; }, {} as Record<string, number>);
  const avgPpsf = filteredSales.filter((c) => c.price_per_sqft).reduce((s, c) => s + (c.price_per_sqft || 0), 0) / (filteredSales.filter((c) => c.price_per_sqft).length || 1);
  const avgCap = filteredSales.filter((c) => c.cap_rate && c.cap_rate > 0).reduce((s, c) => s + (c.cap_rate || 0), 0) / (filteredSales.filter((c) => c.cap_rate && c.cap_rate > 0).length || 1);

  // Pagination
  const totalPages = Math.ceil(filteredSales.length / PAGE_SIZE);
  const paginatedSales = filteredSales.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [filter, cityFilter, statusFilter, search]);

  // Import handler
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    setImporting(true);
    setImportResult(null);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }
    formData.append("includeActive", "true");

    try {
      const res = await fetch("/api/comps/import", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        setImportResult(`Imported ${data.totalInserted} comps from ${data.totalFiles} file(s)`);
        load();
      } else {
        setImportResult(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setImportResult(`Error: ${err.message}`);
    }
    setImporting(false);
  };

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-cream">Comp Database</h1>
          <p className="text-xs text-cream-muted mt-0.5">
            {totalSales.toLocaleString()} sale comps &bull; {totalLeases.toLocaleString()} lease comps &bull; {cities.length} cities
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={handleImport} />
          <IconBtn onClick={() => fileInputRef.current?.click()}>
            {importing ? "⏳" : "📥"}
          </IconBtn>
          <IconBtn onClick={() => setShowAdd(!showAdd)}>➕</IconBtn>
        </div>
      </div>

      {/* Import feedback */}
      {importResult && (
        <div className="panel px-4 py-2 text-xs text-cream-muted flex justify-between items-center">
          <span>{importResult}</span>
          <button className="text-cream-muted hover:text-cream" onClick={() => setImportResult(null)}>✕</button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Panel title="" className="p-4 text-center">
          <div className="text-2xl font-bold text-cream">{totalSales.toLocaleString()}</div>
          <div className="text-[10px] text-cream-muted mt-0.5">Sale Comps</div>
        </Panel>
        <Panel title="" className="p-4 text-center">
          <div className="text-2xl font-bold text-cream">{cities.length}</div>
          <div className="text-[10px] text-cream-muted mt-0.5">Cities Covered</div>
        </Panel>
        <Panel title="" className="p-4 text-center">
          <div className="text-2xl font-bold" style={{ color: C.teal }}>{avgPpsf > 0 ? `$${avgPpsf.toFixed(0)}` : "—"}</div>
          <div className="text-[10px] text-cream-muted mt-0.5">Avg $/SF (Filtered)</div>
        </Panel>
        <Panel title="" className="p-4 text-center">
          <div className="text-2xl font-bold" style={{ color: C.coral }}>{avgCap > 0 ? `${(avgCap * 100).toFixed(1)}%` : "—"}</div>
          <div className="text-[10px] text-cream-muted mt-0.5">Avg Cap Rate (Filtered)</div>
        </Panel>
      </div>

      {/* Tabs + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2">
          <button
            className={`px-3 py-1.5 text-xs font-semibold rounded ${tab === "sale" ? "bg-coral/20 text-coral" : "text-cream-muted hover:text-cream"}`}
            style={tab === "sale" ? { background: C.coralM, color: C.coral } : {}}
            onClick={() => setTab("sale")}
          >
            Sale Comps ({totalSales})
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-semibold rounded ${tab === "lease" ? "bg-teal/20 text-teal" : "text-cream-muted hover:text-cream"}`}
            style={tab === "lease" ? { background: C.tealM, color: C.teal } : {}}
            onClick={() => setTab("lease")}
          >
            Lease Comps ({totalLeases})
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Search address, buyer, seller..."
            className="bg-white/5 border border-white/10 rounded px-3 py-1.5 text-xs text-cream placeholder:text-cream-muted/50 w-56 focus:outline-none focus:border-coral/40"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-cream"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
          >
            <option value="all">All Cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c} ({cityCounts[c]})</option>
            ))}
          </select>
          <select
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-cream"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All Types</option>
            {assetTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-cream"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="sold">Sold</option>
            <option value="active">Active</option>
            <option value="uc">Under Contract</option>
          </select>
        </div>
      </div>

      {/* Results count + pagination */}
      <div className="flex items-center justify-between text-xs text-cream-muted">
        <span>
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredSales.length)} of {filteredSales.length} sale comps
          {filteredSales.length < totalSales && ` (filtered from ${totalSales})`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30"
              disabled={page === 0}
              onClick={() => setPage(0)}
            >
              ««
            </button>
            <button
              className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              «
            </button>
            <span className="px-2 text-cream">
              {page + 1} / {totalPages}
            </span>
            <button
              className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              »
            </button>
            <button
              className="px-2 py-1 rounded hover:bg-white/10 disabled:opacity-30"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(totalPages - 1)}
            >
              »»
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {tab === "sale" && (
        <Panel title="" className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-cream-muted border-b border-white/5">
                <th className="text-left px-3 py-2.5 font-medium">Address</th>
                <th className="text-left px-3 py-2.5 font-medium">City</th>
                <th className="text-left px-3 py-2.5 font-medium">Type</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="text-right px-3 py-2.5 font-medium">Sale Price</th>
                <th className="text-right px-3 py-2.5 font-medium">$/SF</th>
                <th className="text-right px-3 py-2.5 font-medium">Cap</th>
                <th className="text-right px-3 py-2.5 font-medium">SF</th>
                <th className="text-right px-3 py-2.5 font-medium">Year</th>
                <th className="text-left px-3 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-cream-muted">Loading comps...</td></tr>
              ) : filteredSales.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-cream-muted">No comps match your filters</td></tr>
              ) : (
                paginatedSales.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-white/[0.03] hover:bg-white/[0.03] cursor-pointer transition-colors"
                    onClick={() => setSelected(selected?.id === c.id ? null : c)}
                  >
                    <td className="px-3 py-2.5 text-cream font-medium max-w-[220px] truncate">{c.address}</td>
                    <td className="px-3 py-2.5 text-cream-muted">{c.city}</td>
                    <td className="px-3 py-2.5"><AssetBadge type={c.asset_type} /></td>
                    <td className="px-3 py-2.5"><StatusDot notes={c.notes} /></td>
                    <td className="px-3 py-2.5 text-right text-cream">{fmt(c.sale_price)}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: C.teal }}>{fmtPsf(c.price_per_sqft)}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: C.coral }}>{fmtCap(c.cap_rate)}</td>
                    <td className="px-3 py-2.5 text-right text-cream-muted">{fmtNum(c.sqft)}</td>
                    <td className="px-3 py-2.5 text-right text-cream-muted">{c.year_built || "—"}</td>
                    <td className="px-3 py-2.5 text-cream-muted">{fmtDate(c.sale_date)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === "lease" && (
        <Panel title="" className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-cream-muted border-b border-white/5">
                <th className="text-left px-3 py-2.5 font-medium">Address</th>
                <th className="text-left px-3 py-2.5 font-medium">City</th>
                <th className="text-left px-3 py-2.5 font-medium">Type</th>
                <th className="text-left px-3 py-2.5 font-medium">Tenant</th>
                <th className="text-right px-3 py-2.5 font-medium">Rent/SF</th>
                <th className="text-right px-3 py-2.5 font-medium">SF</th>
                <th className="text-left px-3 py-2.5 font-medium">Lease Type</th>
                <th className="text-left px-3 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-cream-muted">Loading comps...</td></tr>
              ) : leaseComps.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-cream-muted">No lease comps yet</td></tr>
              ) : (
                leaseComps.map((c) => (
                  <tr key={c.id} className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors">
                    <td className="px-3 py-2.5 text-cream font-medium max-w-[220px] truncate">{c.address}</td>
                    <td className="px-3 py-2.5 text-cream-muted">{c.city}</td>
                    <td className="px-3 py-2.5"><AssetBadge type={c.asset_type} /></td>
                    <td className="px-3 py-2.5 text-cream-muted max-w-[160px] truncate">{c.tenant_name || "—"}</td>
                    <td className="px-3 py-2.5 text-right" style={{ color: C.teal }}>{fmtPsf(c.rent_per_sqft)}</td>
                    <td className="px-3 py-2.5 text-right text-cream-muted">{fmtNum(c.sqft)}</td>
                    <td className="px-3 py-2.5 text-cream-muted">{c.lease_type || "—"}</td>
                    <td className="px-3 py-2.5 text-cream-muted">{fmtDate(c.lease_date)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Detail panel */}
      {selected && (
        <Panel title="" className="p-5 space-y-3">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-sm font-bold text-cream">{selected.address}</h2>
              <p className="text-xs text-cream-muted">{selected.city}, {selected.state}</p>
            </div>
            <button className="text-cream-muted hover:text-cream text-sm" onClick={() => setSelected(null)}>✕</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <div className="text-cream-muted">Sale Price</div>
              <div className="text-cream font-semibold">{fmt(selected.sale_price)}</div>
            </div>
            <div>
              <div className="text-cream-muted">Price/SF</div>
              <div className="font-semibold" style={{ color: C.teal }}>{fmtPsf(selected.price_per_sqft)}</div>
            </div>
            <div>
              <div className="text-cream-muted">Cap Rate</div>
              <div className="font-semibold" style={{ color: C.coral }}>{fmtCap(selected.cap_rate)}</div>
            </div>
            <div>
              <div className="text-cream-muted">Building SF</div>
              <div className="text-cream font-semibold">{fmtNum(selected.sqft)}</div>
            </div>
            <div>
              <div className="text-cream-muted">Asset Type</div>
              <div className="text-cream">{selected.asset_type || "—"}</div>
            </div>
            <div>
              <div className="text-cream-muted">Year Built</div>
              <div className="text-cream">{selected.year_built || "—"}</div>
            </div>
            <div>
              <div className="text-cream-muted">Acreage</div>
              <div className="text-cream">{selected.acreage || "—"}</div>
            </div>
            <div>
              <div className="text-cream-muted">Sale Date</div>
              <div className="text-cream">{fmtDate(selected.sale_date)}</div>
            </div>
            {selected.buyer && (
              <div className="col-span-2">
                <div className="text-cream-muted">Buyer</div>
                <div className="text-cream">{selected.buyer}</div>
              </div>
            )}
            {selected.seller && (
              <div className="col-span-2">
                <div className="text-cream-muted">Seller</div>
                <div className="text-cream">{selected.seller}</div>
              </div>
            )}
          </div>
          {selected.notes && (
            <div className="text-xs text-cream-muted border-t border-white/5 pt-3 mt-3">
              {selected.notes}
            </div>
          )}
          {selected.latitude && selected.longitude && (
            <div className="text-[10px] text-cream-muted/50">
              📍 {selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)} &bull; {selected.data_source}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
