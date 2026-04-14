"use client";

import { useState } from "react";
import Panel from "./panel";
import { btnPrimary, btnSecondary, inputStyle, selectStyle, FormField } from "./modal";

// ── Types ──────────────────────────────────────────────────

interface UnitInput {
  name: string;
  sqft: string;
}

interface ValuationResultData {
  valuation: {
    subject: {
      address: string;
      geocoded: {
        formattedAddress: string;
        city: string;
        state: string;
        county: string;
      };
      assetType: string;
      sqft: number | null;
    };
    comps: {
      saleComps: any[];
      leaseComps: any[];
      radiusMiles: number;
      totalFound: number;
    };
    methodology: string;
    incomeApproach: {
      available: boolean;
      estimatedMarketRent?: number;
      estimatedNOI?: number;
      capRateRange: { low: number; mid: number; high: number };
      valueRange?: { low: number; mid: number; high: number };
    } | null;
    salesComparison: {
      available: boolean;
      pricePsfRange?: { low: number; mid: number; high: number };
      valueRange?: { low: number; mid: number; high: number };
      avgCapRate?: number;
    } | null;
    reconciledValue: {
      low: number;
      mid: number;
      high: number;
      confidence: string;
      basis: string;
    } | null;
    narrative: string;
    disclaimers: string[];
  };
  reports?: Record<string, string>;
}

// ── Helpers ────────────────────────────────────────────────

function fmt$(n: number | undefined | null): string {
  if (n == null) return "N/A";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPsf(n: number | undefined | null): string {
  if (n == null) return "N/A";
  return "$" + n.toFixed(2) + "/SF";
}

function fmtPct(n: number | undefined | null): string {
  if (n == null) return "N/A";
  return (n * 100).toFixed(1) + "%";
}

// ── Component ──────────────────────────────────────────────

export default function ValuateContent() {
  // Form state
  const [address, setAddress] = useState("");
  const [assetType, setAssetType] = useState("");
  const [totalSqft, setTotalSqft] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [units, setUnits] = useState<UnitInput[]>([{ name: "", sqft: "" }]);
  const [annualIncome, setAnnualIncome] = useState("");
  const [annualExpenses, setAnnualExpenses] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [showIncome, setShowIncome] = useState(false);

  // Result state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ValuationResultData | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // ── Unit management ────────────────────────────────────
  const addUnit = () => setUnits([...units, { name: "", sqft: "" }]);

  const removeUnit = (idx: number) => {
    if (units.length <= 1) return;
    setUnits(units.filter((_, i) => i !== idx));
  };

  const updateUnit = (idx: number, field: keyof UnitInput, value: string) => {
    const updated = [...units];
    updated[idx] = { ...updated[idx], [field]: value };
    setUnits(updated);
  };

  // ── Run valuation ──────────────────────────────────────
  const runValuation = async () => {
    if (!address.trim()) {
      setError("Please enter a property address.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    const parsedUnits = units
      .filter((u) => u.sqft && parseFloat(u.sqft) > 0)
      .map((u, i) => ({
        name: u.name || `Unit ${i + 1}`,
        sqft: parseFloat(u.sqft),
      }));

    const computedSqft = totalSqft
      ? parseFloat(totalSqft)
      : parsedUnits.reduce((sum, u) => sum + u.sqft, 0) || undefined;

    const body: any = {
      address: address.trim(),
      assetType: assetType || undefined,
      sqft: computedSqft,
      yearBuilt: yearBuilt ? parseInt(yearBuilt) : undefined,
      units: parsedUnits.length > 0 ? parsedUnits : undefined,
      annualIncome: annualIncome ? parseFloat(annualIncome) : undefined,
      annualExpenses: annualExpenses ? parseFloat(annualExpenses) : undefined,
      occupancyPct: occupancy ? parseFloat(occupancy) / 100 : undefined,
    };

    try {
      const res = await fetch("/api/valuate?format=all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Valuation failed");
        return;
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  // ── Download PDF ───────────────────────────────────────
  const downloadPdf = (reportType: string, label: string) => {
    if (!result?.reports?.[reportType]) return;
    setDownloading(reportType);

    const bytes = Uint8Array.from(atob(result.reports[reportType]), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${address.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 40)}_${label}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloading(null);
  };

  // ── Reset ──────────────────────────────────────────────
  const reset = () => {
    setResult(null);
    setError("");
  };

  const v = result?.valuation;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Property Valuation</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(240,237,228,0.45)" }}>
            Enter a property address to run a full valuation with comp analysis and PDF reports
          </p>
        </div>
        {result && (
          <button style={btnSecondary} onClick={reset}>
            New Valuation
          </button>
        )}
      </div>

      {/* Form + Results layout */}
      <div style={{ display: "grid", gridTemplateColumns: result ? "380px 1fr" : "1fr", gap: 16 }}>
        {/* ── LEFT: Input Form ────────────────────────────── */}
        <Panel title="Subject Property" actions={<span />}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <FormField label="Property Address *">
              <input
                style={inputStyle}
                placeholder="123 Main St, City, State"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && runValuation()}
              />
            </FormField>

            <FormField label="Asset Type">
              <select
                style={selectStyle}
                value={assetType}
                onChange={(e) => setAssetType(e.target.value)}
              >
                <option value="">Auto-detect from comps</option>
                <option value="Retail">Retail</option>
                <option value="Office">Office</option>
                <option value="Industrial">Industrial</option>
                <option value="Multifamily">Multifamily</option>
                <option value="Flex">Flex</option>
                <option value="Land">Land</option>
                <option value="Hospitality">Hospitality</option>
                <option value="Medical">Medical Office</option>
              </select>
            </FormField>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <FormField label="Total SF">
                <input
                  style={inputStyle}
                  type="number"
                  placeholder="e.g. 12000"
                  value={totalSqft}
                  onChange={(e) => setTotalSqft(e.target.value)}
                />
              </FormField>
              <FormField label="Year Built">
                <input
                  style={inputStyle}
                  type="number"
                  placeholder="e.g. 1995"
                  value={yearBuilt}
                  onChange={(e) => setYearBuilt(e.target.value)}
                />
              </FormField>
            </div>

            {/* Unit Mix */}
            <div style={{ marginTop: 4 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}
              >
                <label
                  style={{
                    fontSize: 10.5,
                    color: "rgba(240,237,228,0.45)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 500,
                  }}
                >
                  Unit Mix
                </label>
                <button
                  onClick={addUnit}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#E07A5F",
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  + Add Unit
                </button>
              </div>

              {units.map((unit, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 28px",
                    gap: 6,
                    marginBottom: 6,
                  }}
                >
                  <input
                    style={{ ...inputStyle, fontSize: 11.5 }}
                    placeholder={`Unit ${idx + 1} name`}
                    value={unit.name}
                    onChange={(e) => updateUnit(idx, "name", e.target.value)}
                  />
                  <input
                    style={{ ...inputStyle, fontSize: 11.5 }}
                    type="number"
                    placeholder="SF"
                    value={unit.sqft}
                    onChange={(e) => updateUnit(idx, "sqft", e.target.value)}
                  />
                  <button
                    onClick={() => removeUnit(idx)}
                    style={{
                      background: "none",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 4,
                      color: "rgba(240,237,228,0.3)",
                      cursor: units.length <= 1 ? "default" : "pointer",
                      fontSize: 12,
                      opacity: units.length <= 1 ? 0.3 : 1,
                      fontFamily: "inherit",
                    }}
                    disabled={units.length <= 1}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            {/* Income toggle */}
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => setShowIncome(!showIncome)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(240,237,228,0.5)",
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                {showIncome ? "- Hide" : "+ Show"} Income Details (optional)
              </button>
            </div>

            {showIncome && (
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.05)",
                  borderRadius: 5,
                }}
              >
                <FormField label="Annual Gross Income">
                  <input
                    style={inputStyle}
                    type="number"
                    placeholder="$"
                    value={annualIncome}
                    onChange={(e) => setAnnualIncome(e.target.value)}
                  />
                </FormField>
                <FormField label="Annual Expenses">
                  <input
                    style={inputStyle}
                    type="number"
                    placeholder="$"
                    value={annualExpenses}
                    onChange={(e) => setAnnualExpenses(e.target.value)}
                  />
                </FormField>
                <FormField label="Occupancy %">
                  <input
                    style={inputStyle}
                    type="number"
                    placeholder="e.g. 92"
                    value={occupancy}
                    onChange={(e) => setOccupancy(e.target.value)}
                  />
                </FormField>
              </div>
            )}

            {/* Error */}
            {error && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  borderRadius: 5,
                  fontSize: 12,
                  color: "#ef4444",
                }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              style={{
                ...btnPrimary,
                marginTop: 12,
                width: "100%",
                opacity: loading ? 0.7 : 1,
                pointerEvents: loading ? "none" : "auto",
              }}
              onClick={runValuation}
              disabled={loading}
            >
              {loading ? "Running Valuation..." : "Run Valuation"}
            </button>

            {loading && (
              <p
                style={{
                  fontSize: 11,
                  color: "rgba(240,237,228,0.4)",
                  textAlign: "center",
                  margin: "6px 0 0",
                }}
              >
                Geocoding address, pulling comps, running analysis...
              </p>
            )}
          </div>
        </Panel>

        {/* ── RIGHT: Results ──────────────────────────────── */}
        {result && v && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Value Summary */}
            <Panel title="Valuation Summary" actions={<span />}>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Subject info */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {v.subject.geocoded.formattedAddress}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)", marginTop: 2 }}>
                      {v.subject.assetType}
                      {v.subject.sqft ? ` | ${v.subject.sqft.toLocaleString()} SF` : ""}
                    </div>
                  </div>
                  {v.reconciledValue && (
                    <div
                      style={{
                        padding: "4px 10px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        background:
                          v.reconciledValue.confidence === "high"
                            ? "rgba(34,197,94,0.15)"
                            : v.reconciledValue.confidence === "medium"
                              ? "rgba(234,179,8,0.15)"
                              : "rgba(239,68,68,0.15)",
                        color:
                          v.reconciledValue.confidence === "high"
                            ? "#22c55e"
                            : v.reconciledValue.confidence === "medium"
                              ? "#eab308"
                              : "#ef4444",
                      }}
                    >
                      {v.reconciledValue.confidence} confidence
                    </div>
                  )}
                </div>

                {/* Reconciled Value */}
                {v.reconciledValue && (
                  <div
                    style={{
                      padding: 16,
                      background: "rgba(224,122,95,0.06)",
                      border: "1px solid rgba(224,122,95,0.18)",
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "rgba(240,237,228,0.45)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 6,
                      }}
                    >
                      Reconciled Value Range
                    </div>
                    <div style={{ display: "flex", gap: 24, alignItems: "baseline" }}>
                      <div>
                        <span style={{ fontSize: 10, color: "rgba(240,237,228,0.4)" }}>Low </span>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>
                          {fmt$(v.reconciledValue.low)}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontSize: 10, color: "rgba(240,237,228,0.4)" }}>Mid </span>
                        <span style={{ fontSize: 22, fontWeight: 700, color: "#E07A5F" }}>
                          {fmt$(v.reconciledValue.mid)}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontSize: 10, color: "rgba(240,237,228,0.4)" }}>High </span>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>
                          {fmt$(v.reconciledValue.high)}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)", marginTop: 6 }}>
                      {v.reconciledValue.basis}
                    </div>
                  </div>
                )}

                {/* Approaches grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Income Approach */}
                  <div
                    style={{
                      padding: 12,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 5,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "rgba(240,237,228,0.4)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        marginBottom: 8,
                      }}
                    >
                      Income Approach
                    </div>
                    {v.incomeApproach?.available ? (
                      <>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: "rgba(240,237,228,0.5)" }}>Market Rent: </span>
                          {fmtPsf(v.incomeApproach.estimatedMarketRent)}
                        </div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: "rgba(240,237,228,0.5)" }}>Est. NOI: </span>
                          {fmt$(v.incomeApproach.estimatedNOI)}
                        </div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: "rgba(240,237,228,0.5)" }}>Cap Rate: </span>
                          {fmtPct(v.incomeApproach.capRateRange.low)} -{" "}
                          {fmtPct(v.incomeApproach.capRateRange.high)}
                        </div>
                        {v.incomeApproach.valueRange && (
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>
                            {fmt$(v.incomeApproach.valueRange.low)} -{" "}
                            {fmt$(v.incomeApproach.valueRange.high)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: "rgba(240,237,228,0.3)" }}>
                        Insufficient data
                      </div>
                    )}
                  </div>

                  {/* Sales Comparison */}
                  <div
                    style={{
                      padding: 12,
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 5,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "rgba(240,237,228,0.4)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        marginBottom: 8,
                      }}
                    >
                      Sales Comparison
                    </div>
                    {v.salesComparison?.available ? (
                      <>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: "rgba(240,237,228,0.5)" }}>Price/SF: </span>
                          {fmtPsf(v.salesComparison.pricePsfRange?.low)} -{" "}
                          {fmtPsf(v.salesComparison.pricePsfRange?.high)}
                        </div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: "rgba(240,237,228,0.5)" }}>Avg Cap: </span>
                          {fmtPct(v.salesComparison.avgCapRate)}
                        </div>
                        {v.salesComparison.valueRange && (
                          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>
                            {fmt$(v.salesComparison.valueRange.low)} -{" "}
                            {fmt$(v.salesComparison.valueRange.high)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: "rgba(240,237,228,0.3)" }}>
                        Insufficient data
                      </div>
                    )}
                  </div>
                </div>

                {/* Methodology */}
                <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)" }}>
                  <strong style={{ color: "rgba(240,237,228,0.6)" }}>Methodology:</strong>{" "}
                  {v.methodology}
                </div>
              </div>
            </Panel>

            {/* Comps Summary */}
            <Panel title={`Comparable Sales (${v.comps.saleComps.length})`} actions={<span />}>
              <div style={{ fontSize: 11, color: "rgba(240,237,228,0.4)", marginBottom: 8 }}>
                {v.comps.totalFound} comps found within {v.comps.radiusMiles} mile radius
              </div>
              <div style={{ maxHeight: 280, overflowY: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 11,
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        textAlign: "left",
                      }}
                    >
                      <th style={thStyle}>Address</th>
                      <th style={thStyle}>Dist</th>
                      <th style={thStyle}>Price</th>
                      <th style={thStyle}>$/SF</th>
                      <th style={thStyle}>Cap</th>
                      <th style={thStyle}>SF</th>
                      <th style={thStyle}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.comps.saleComps.slice(0, 15).map((c: any, i: number) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.03)",
                        }}
                      >
                        <td style={tdStyle} title={c.address}>
                          <div
                            style={{
                              maxWidth: 200,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.address}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          {c.distanceMiles != null ? c.distanceMiles.toFixed(1) + " mi" : "-"}
                        </td>
                        <td style={tdStyle}>{fmt$(c.salePrice)}</td>
                        <td style={tdStyle}>{fmtPsf(c.pricePsf)}</td>
                        <td style={tdStyle}>{c.capRate ? fmtPct(c.capRate) : "-"}</td>
                        <td style={tdStyle}>
                          {c.sqft ? c.sqft.toLocaleString() : "-"}
                        </td>
                        <td style={tdStyle}>{c.saleDate || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* Narrative */}
            {v.narrative && (
              <Panel title="Market Narrative" actions={<span />}>
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: "rgba(240,237,228,0.7)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {v.narrative}
                </div>
              </Panel>
            )}

            {/* PDF Downloads */}
            <Panel title="Download Reports" actions={<span />}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { key: "sale-bov", label: "BOV Sale", file: "BOV_Sale" },
                  { key: "rental-opinion", label: "Rental Opinion", file: "Rental_Opinion" },
                  {
                    key: "stabilized-valuation",
                    label: "Stabilized Valuation",
                    file: "Stabilized_Valuation",
                  },
                ].map((r) => (
                  <button
                    key={r.key}
                    style={{
                      ...btnSecondary,
                      opacity: result.reports?.[r.key] ? 1 : 0.35,
                      cursor: result.reports?.[r.key] ? "pointer" : "default",
                    }}
                    onClick={() => downloadPdf(r.key, r.file)}
                    disabled={!result.reports?.[r.key] || downloading === r.key}
                  >
                    {downloading === r.key ? "Downloading..." : `${r.label} PDF`}
                  </button>
                ))}
              </div>

              {/* Disclaimers */}
              {v.disclaimers && v.disclaimers.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {v.disclaimers.map((d: string, i: number) => (
                    <p
                      key={i}
                      style={{
                        fontSize: 10,
                        color: "rgba(240,237,228,0.3)",
                        margin: "4px 0",
                        lineHeight: 1.4,
                      }}
                    >
                      {d}
                    </p>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Table styles ──────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 10,
  color: "rgba(240,237,228,0.4)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 11.5,
  color: "rgba(240,237,228,0.7)",
};
