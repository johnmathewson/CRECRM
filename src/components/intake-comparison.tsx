"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import * as XLSX from "xlsx";
import Panel, { IconBtn } from "./panel";
import { btnPrimary, btnSecondary } from "./modal";
import type { IntakeUnit } from "./intake-editable-table";

// ── Types ──────────────────────────────────────────────────
interface Comp {
  id: string;
  property_name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  submarket: string | null;
  asset_type: string | null;
  tenant_name: string | null;
  suite: string | null;
  square_footage: number | null;
  lease_rate: number | null;
  lease_type: string | null;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: number | null;
  annual_rent: number | null;
  source: string | null;
  file_name: string | null;
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────
const C = {
  coral: "#E07A5F",
  teal: "#4ECDC4",
  green: "#6BCB77",
  amber: "#F2C94C",
  red: "#E74C3C",
};

const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtRate = (n: number) => "$" + n.toFixed(2);
const fmtSF = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";

// ── Component ──────────────────────────────────────────────
interface Props {
  units: IntakeUnit[];
  propertyName: string;
  intakeId: string | null;
  onSaveIntakeFirst: () => Promise<string | null>; // returns intakeId after saving
}

export default function IntakeComparison({ units, propertyName, intakeId, onSaveIntakeFirst }: Props) {
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [savingComps, setSavingComps] = useState(false);
  const [pendingComps, setPendingComps] = useState<any[]>([]);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load comps for THIS intake only
  const loadComps = useCallback(async () => {
    if (!intakeId) { setComps([]); return; }
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("comps")
      .select("*")
      .eq("intake_id", intakeId)
      .order("created_at", { ascending: false });
    setComps((data as Comp[]) || []);
    setLoading(false);
  }, [intakeId]);

  useEffect(() => { loadComps(); }, [loadComps]);

  // Parse file client-side, send text to API
  const handleUploadComps = useCallback(async (file: File) => {
    setUploadError("");
    setUploading(true);
    try {
      const name = file.name.toLowerCase();
      let payload: any = {};

      if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheets: string[] = [];
        for (const sn of wb.SheetNames) {
          sheets.push(`--- Sheet: ${sn} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`);
        }
        payload = { text: sheets.join("\n\n") };
      } else if (name.match(/\.(jpg|jpeg|png|webp)$/)) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf); let binary = ""; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]); const base64 = btoa(binary);
        payload = { isImage: true, imageData: base64, mediaType: name.endsWith(".png") ? "image/png" : "image/jpeg" };
      } else {
        setUploadError("Supported formats: Excel (.xlsx/.xls), CSV, JPG, PNG"); setUploading(false); return;
      }

      const res = await fetch("/api/comps/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { setUploadError("Server error — try again."); setUploading(false); return; }
      if (!res.ok) { setUploadError(data.error || "Parse failed"); setUploading(false); return; }
      setPendingComps(data.comps || []);
    } catch (err: any) {
      setUploadError(err.message);
    }
    setUploading(false);
  }, []);

  // Save pending comps — auto-save intake first if needed
  const savePendingComps = useCallback(async () => {
    setSavingComps(true);
    try {
      let id = intakeId;
      if (!id) {
        id = await onSaveIntakeFirst();
        if (!id) { setUploadError("Please save the intake first"); setSavingComps(false); return; }
      }

      const res = await fetch("/api/comps/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comps: pendingComps, source: "upload", intakeId: id }),
      });
      if (!res.ok) { const d = await res.json(); setUploadError(d.error); setSavingComps(false); return; }
      // Add saved comps directly to state (loadComps may have stale intakeId)
      const savedAsComps: Comp[] = pendingComps.map((c: any, i: number) => ({
        id: `pending-${i}`,
        property_name: c.property_name || "Unknown",
        address: c.address || null, city: c.city || null, state: c.state || null,
        submarket: c.submarket || null, asset_type: c.asset_type || null,
        tenant_name: c.tenant_name || null, suite: c.suite || null,
        square_footage: c.square_footage || null, lease_rate: c.lease_rate || null,
        lease_type: c.lease_type || null, lease_start: c.lease_start || null,
        lease_end: c.lease_end || null, monthly_rent: c.monthly_rent || null,
        annual_rent: c.annual_rent || null, source: "upload", file_name: null,
        created_at: new Date().toISOString(),
      }));
      setComps((prev) => [...savedAsComps, ...prev]);
      setPendingComps([]);
    } catch (err: any) { setUploadError(err.message); }
    setSavingComps(false);
  }, [pendingComps, intakeId, onSaveIntakeFirst, loadComps]);

  // ── Comparison logic ─────────────────────────────────────
  const occupiedUnits = units.filter((u) => !u.is_vacant && u.lease_rate);
  const intakeTotalSF = occupiedUnits.reduce((s, u) => s + (u.square_footage || 0), 0);
  const intakeWeightedRate = intakeTotalSF > 0
    ? occupiedUnits.reduce((s, u) => s + (u.lease_rate || 0) * (u.square_footage || 0), 0) / intakeTotalSF
    : 0;
  const intakeTotalAnnual = units.reduce((s, u) => s + (u.annual_rent || 0), 0);

  const compsWithRate = comps.filter((c) => c.lease_rate && c.lease_rate > 0);
  const compTotalSF = compsWithRate.reduce((s, c) => s + (Number(c.square_footage) || 0), 0);
  const compWeightedRate = compTotalSF > 0
    ? compsWithRate.reduce((s, c) => s + (Number(c.lease_rate) || 0) * (Number(c.square_footage) || 0), 0) / compTotalSF
    : 0;

  const rateDelta = intakeWeightedRate > 0 && compWeightedRate > 0
    ? ((compWeightedRate - intakeWeightedRate) / intakeWeightedRate) * 100
    : null;
  const potentialAnnual = compWeightedRate > 0 ? intakeTotalSF * compWeightedRate : 0;
  const revenueDelta = potentialAnnual > 0 ? potentialAnnual - intakeTotalAnnual : 0;

  const unitComparisons = occupiedUnits.map((u) => {
    const sf = u.square_footage || 0;
    const similar = compsWithRate.filter((c) => {
      const csf = Number(c.square_footage) || 0;
      return csf > 0 && sf > 0 && Math.abs(csf - sf) / sf < 0.3;
    });
    const avgCompRate = similar.length > 0
      ? similar.reduce((s, c) => s + Number(c.lease_rate!), 0) / similar.length
      : compWeightedRate;
    const delta = u.lease_rate && avgCompRate > 0
      ? ((avgCompRate - u.lease_rate) / u.lease_rate) * 100
      : null;
    return { ...u, compRate: avgCompRate, delta, matchCount: similar.length };
  });

  const hasComps = comps.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Comps for this Property ── */}
      <Panel
        title={`Comps for ${propertyName} — ${comps.length} records`}
        actions={
          <div className="flex gap-1 items-center">
            <IconBtn onClick={loadComps}>↻</IconBtn>
          </div>
        }
      >
        {/* Upload area — always visible when no comps yet */}
        <div className="glass-inner p-3.5 mb-3" style={{ borderLeft: `2px solid ${C.teal}` }}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUploadComps(f);
            }}
          />
          {pendingComps.length > 0 ? (
            <div>
              <div className="text-[12px] font-medium text-cream mb-2">
                {pendingComps.length} comps extracted — review and save to this property:
              </div>
              <div className="overflow-x-auto mb-2" style={{ maxHeight: 200 }}>
                <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 2px" }}>
                  <thead>
                    <tr className="text-[9.5px] text-cream-subtle uppercase tracking-wider">
                      {["Property", "Tenant", "SF", "Rate/SF", "Type", "City"].map((h) => (
                        <th key={h} className="px-2 pb-1.5 font-medium text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pendingComps.slice(0, 10).map((c: any, i: number) => (
                      <tr key={i}>
                        <td className="px-2 py-1 text-[11px]" style={{ background: "rgba(255,255,255,0.02)" }}>{c.property_name || "—"}</td>
                        <td className="px-2 py-1 text-[11px] text-cream-muted" style={{ background: "rgba(255,255,255,0.02)" }}>{c.tenant_name || "—"}</td>
                        <td className="px-2 py-1 text-[11px] tnum" style={{ background: "rgba(255,255,255,0.02)" }}>{c.square_footage ? fmtSF(c.square_footage) : "—"}</td>
                        <td className="px-2 py-1 text-[11px] font-semibold tnum" style={{ background: "rgba(255,255,255,0.02)", color: C.teal }}>{c.lease_rate ? fmtRate(c.lease_rate) : "—"}</td>
                        <td className="px-2 py-1 text-[11px] text-cream-muted" style={{ background: "rgba(255,255,255,0.02)" }}>{c.lease_type || "—"}</td>
                        <td className="px-2 py-1 text-[11px] text-cream-muted" style={{ background: "rgba(255,255,255,0.02)" }}>{c.city || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pendingComps.length > 10 && (
                  <div className="text-[10.5px] text-cream-subtle mt-1">...and {pendingComps.length - 10} more</div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  style={{ ...btnPrimary, fontSize: 11, padding: "6px 14px", background: "linear-gradient(135deg, #4ECDC4, #4ECDC4CC)", boxShadow: "0 2px 10px rgba(78,205,196,0.3)" }}
                  onClick={savePendingComps}
                  disabled={savingComps}
                >
                  {savingComps ? "Saving..." : `Save ${pendingComps.length} Comps to ${propertyName}`}
                </button>
                <button style={{ ...btnSecondary, fontSize: 11, padding: "6px 14px" }} onClick={() => setPendingComps([])}>
                  Discard
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="text-[12px] text-cream-muted">
                {hasComps ? "Upload more comps for this property" : "Upload comparable lease data for this property (Excel, CSV, or image)"}
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 text-[11px] font-semibold cursor-pointer"
                style={{
                  borderRadius: 4,
                  border: "none",
                  fontFamily: "inherit",
                  background: "linear-gradient(135deg, #4ECDC4, #4ECDC4CC)",
                  color: "white",
                  boxShadow: "0 2px 8px rgba(78,205,196,0.3)",
                  opacity: uploading ? 0.5 : 1,
                }}
              >
                {uploading ? "Analyzing..." : "+ Upload Comps"}
              </button>
            </div>
          )}
          {uploadError && <div className="text-[11px] mt-2 font-medium" style={{ color: C.coral }}>{uploadError}</div>}
        </div>

        {/* Saved comps list */}
        {loading ? (
          <div className="text-cream-muted text-[12px] animate-pulse py-3 text-center">Loading comps...</div>
        ) : comps.length === 0 ? (
          <div className="text-cream-subtle text-[12px] py-2 text-center">No comps for this property yet</div>
        ) : (
          <>
            <div className="overflow-x-auto" style={{ maxHeight: 220 }}>
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 2px" }}>
                <thead>
                  <tr className="text-[9.5px] text-cream-subtle uppercase tracking-wider">
                    {["Property", "Tenant", "SF", "Rate/SF", "Type", "City"].map((h, i) => (
                      <th key={h} className={`px-2 pb-1.5 font-medium ${i >= 2 && i <= 3 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comps.map((c) => (
                    <tr key={c.id}>
                      <td className="px-2 py-1.5 text-[11px] font-medium" style={{ background: "rgba(255,255,255,0.02)", borderRadius: "4px 0 0 4px" }}>{c.property_name}</td>
                      <td className="px-2 py-1.5 text-[11px] text-cream-muted" style={{ background: "rgba(255,255,255,0.02)" }}>{c.tenant_name || "—"}</td>
                      <td className="px-2 py-1.5 text-[11px] text-right tnum" style={{ background: "rgba(255,255,255,0.02)" }}>{c.square_footage ? fmtSF(Number(c.square_footage)) : "—"}</td>
                      <td className="px-2 py-1.5 text-[11px] text-right font-semibold tnum" style={{ background: "rgba(255,255,255,0.02)", color: C.teal }}>{c.lease_rate ? fmtRate(Number(c.lease_rate)) : "—"}</td>
                      <td className="px-2 py-1.5 text-[11px] text-cream-muted" style={{ background: "rgba(255,255,255,0.02)" }}>{c.lease_type || "—"}</td>
                      <td className="px-2 py-1.5 text-[11px] text-cream-muted" style={{ background: "rgba(255,255,255,0.02)", borderRadius: "0 4px 4px 0" }}>{c.city || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Apply Market Analysis button */}
            {hasComps && !showAnalysis && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={() => setShowAnalysis(true)}
                  className="px-5 py-2.5 text-[13px] font-bold cursor-pointer"
                  style={{
                    borderRadius: 6,
                    border: "none",
                    fontFamily: "inherit",
                    background: "linear-gradient(135deg, #E07A5F, #E07A5FCC)",
                    color: "white",
                    boxShadow: "0 4px 20px rgba(224,122,95,0.4)",
                    letterSpacing: "0.3px",
                  }}
                >
                  Apply Market Analysis
                </button>
              </div>
            )}
          </>
        )}
      </Panel>

      {/* ── Market Analysis (shown after clicking Apply) ── */}
      {showAnalysis && hasComps && (
        <>
          {/* Summary delta cards */}
          <Panel title="Market Comparison" actions={
            <button
              onClick={() => setShowAnalysis(false)}
              className="text-[10px] text-cream-subtle cursor-pointer hover:text-cream"
              style={{ background: "none", border: "none", fontFamily: "inherit" }}
            >
              Hide
            </button>
          }>
            <div className="grid grid-cols-3 gap-2.5 mb-3">
              <div className="glass-inner p-3">
                <div className="text-[10px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Your Avg Rate/SF</div>
                <div className="text-[22px] font-bold tnum" style={{ color: C.coral }}>{fmtRate(intakeWeightedRate)}</div>
                <div className="text-[10px] text-cream-subtle mt-0.5">{fmtSF(intakeTotalSF)} SF occupied</div>
              </div>
              <div className="glass-inner p-3">
                <div className="text-[10px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Market Avg Rate/SF</div>
                <div className="text-[22px] font-bold tnum" style={{ color: C.teal }}>{fmtRate(compWeightedRate)}</div>
                <div className="text-[10px] text-cream-subtle mt-0.5">{compsWithRate.length} comps</div>
              </div>
              <div className="glass-inner p-3">
                <div className="text-[10px] text-cream-subtle uppercase tracking-wider font-medium mb-1">Rate Delta</div>
                <div className="text-[22px] font-bold tnum" style={{ color: rateDelta !== null && rateDelta > 0 ? C.green : C.red }}>
                  {rateDelta !== null ? fmtPct(rateDelta) : "—"}
                </div>
                <div className="text-[10px] text-cream-subtle mt-0.5">
                  {rateDelta !== null && rateDelta > 0 ? "upside potential" : "above market"}
                </div>
              </div>
            </div>

            {/* Revenue impact */}
            <div className="glass-inner p-3.5" style={{ borderLeft: `2px solid ${revenueDelta > 0 ? C.green : C.coral}` }}>
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-[10px] text-cream-subtle uppercase tracking-wider font-medium mb-0.5">
                    {revenueDelta > 0 ? "Potential Annual Upside" : "Current Premium Over Market"}
                  </div>
                  <div className="text-[20px] font-bold tnum" style={{ color: revenueDelta > 0 ? C.green : C.coral }}>
                    {fmt(Math.abs(revenueDelta))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-cream-subtle mb-0.5">Current Annual</div>
                  <div className="text-[13px] font-semibold tnum">{fmt(intakeTotalAnnual)}</div>
                  <div className="text-[10px] text-cream-subtle mt-1">Market Potential</div>
                  <div className="text-[13px] font-semibold tnum" style={{ color: C.teal }}>{fmt(potentialAnnual)}</div>
                </div>
              </div>
            </div>
          </Panel>

          {/* Per-unit comparison table */}
          <Panel title="Unit-by-Unit Market Analysis" actions={
            <span className="text-[10.5px] text-cream-subtle mr-2">vs. {compsWithRate.length} comps for this property</span>
          }>
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 2px" }}>
                <thead>
                  <tr className="text-[9.5px] text-cream-subtle uppercase tracking-wider">
                    {["Unit", "Tenant", "SF", "Your Rate", "Market Rate", "Delta", "Annual Gap"].map((h, i) => (
                      <th key={h} className={`px-2 pb-1.5 font-medium ${i >= 2 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unitComparisons.map((u, i) => {
                    const gap = u.lease_rate && u.compRate
                      ? (u.compRate - u.lease_rate) * (u.square_footage || 0)
                      : 0;
                    return (
                      <tr key={i}>
                        <td className="px-2 py-1.5 text-[11px] font-medium" style={{ background: "rgba(255,255,255,0.02)", borderRadius: "4px 0 0 4px" }}>
                          {u.unit_number || i + 1}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-cream-muted" style={{ background: "rgba(255,255,255,0.02)" }}>
                          {u.tenant_name || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-right tnum" style={{ background: "rgba(255,255,255,0.02)" }}>
                          {u.square_footage ? fmtSF(u.square_footage) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-right font-semibold tnum" style={{ background: "rgba(255,255,255,0.02)", color: C.coral }}>
                          {u.lease_rate ? fmtRate(u.lease_rate) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-right font-semibold tnum" style={{ background: "rgba(255,255,255,0.02)", color: C.teal }}>
                          {u.compRate > 0 ? fmtRate(u.compRate) : "—"}
                          {u.matchCount > 0 && (
                            <span className="text-[9px] text-cream-subtle ml-1">({u.matchCount})</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-right font-semibold tnum" style={{ background: "rgba(255,255,255,0.02)" }}>
                          {u.delta !== null ? (
                            <span style={{ color: u.delta > 0 ? C.green : u.delta < -2 ? C.red : C.amber }}>
                              {fmtPct(u.delta)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-right font-semibold tnum" style={{ background: "rgba(255,255,255,0.02)", borderRadius: "0 4px 4px 0" }}>
                          {gap !== 0 ? (
                            <span style={{ color: gap > 0 ? C.green : C.red }}>{fmt(Math.abs(gap))}</span>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals footer */}
            <div className="glass-inner flex justify-between items-center mt-2 px-3.5 py-2.5">
              <span className="text-xs font-semibold">{unitComparisons.length} units compared</span>
              <div className="flex gap-5 text-xs tnum">
                <span>Your Total: <span className="font-bold" style={{ color: C.coral }}>{fmt(intakeTotalAnnual)}</span></span>
                <span>Market: <span className="font-bold" style={{ color: C.teal }}>{fmt(potentialAnnual)}</span></span>
                <span>Gap: <span className="font-bold" style={{ color: revenueDelta > 0 ? C.green : C.red }}>{fmt(Math.abs(revenueDelta))}</span></span>
              </div>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
