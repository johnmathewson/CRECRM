"use client";

import { useState, useRef, DragEvent } from "react";
import * as XLSX from "xlsx";
import Panel from "./panel";
import { btnPrimary, btnSecondary, inputStyle, selectStyle, FormField } from "./modal";

// ── Types ──────────────────────────────────────────────────

interface UnitInput {
  name: string;
  sqft: string;
  leaseRate: string;
  leaseType: string;
  monthlyRent: string;
  tenant: string;
  isVacant: boolean;
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

type InputMode = "manual" | "upload";

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

function emptyUnit(): UnitInput {
  return { name: "", sqft: "", leaseRate: "", leaseType: "", monthlyRent: "", tenant: "", isVacant: false };
}

function fileExt(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];
const SPREADSHEET_EXTS = ["xlsx", "xls", "csv"];
const ALL_EXTS = [...SPREADSHEET_EXTS, ...IMAGE_EXTS, "pdf"];

// ── Component ──────────────────────────────────────────────

export default function ValuateContent() {
  // Form state
  const [address, setAddress] = useState("");
  const [assetType, setAssetType] = useState("");
  const [totalSqft, setTotalSqft] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [units, setUnits] = useState<UnitInput[]>([emptyUnit()]);
  const [annualIncome, setAnnualIncome] = useState("");
  const [annualExpenses, setAnnualExpenses] = useState("");
  const [occupancy, setOccupancy] = useState("");
  const [showIncome, setShowIncome] = useState(false);

  // Upload state
  const [inputMode, setInputMode] = useState<InputMode>("manual");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseSource, setParseSource] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Result state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ValuationResultData | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Save-to-pipeline state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedTo, setSavedTo] = useState<{ propertySlug: string; dealId: string | null } | null>(null);
  const [saveRole, setSaveRole] = useState<string>("listing_broker");
  const [saveTxn, setSaveTxn] = useState<string>("sale");

  // ── Unit management ────────────────────────────────────
  const addUnit = () => setUnits([...units, emptyUnit()]);

  const removeUnit = (idx: number) => {
    if (units.length <= 1) return;
    setUnits(units.filter((_, i) => i !== idx));
  };

  const updateUnit = (idx: number, field: keyof UnitInput, value: string) => {
    const updated = [...units];
    updated[idx] = { ...updated[idx], [field]: value };
    setUnits(updated);
  };

  // ── File handling ──────────────────────────────────────
  function handleFile(f: File) {
    setError("");
    if (f.size > 10 * 1024 * 1024) {
      setError("File too large — max 10 MB");
      return;
    }
    const ext = fileExt(f.name);
    if (!ALL_EXTS.includes(ext)) {
      setError("Unsupported file type. Use Excel, CSV, PDF, or image files.");
      return;
    }
    setUploadFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  // ── Parse uploaded file ────────────────────────────────
  async function parseUploadedFile() {
    if (!uploadFile) return;
    setParsing(true);
    setError("");

    const ext = fileExt(uploadFile.name);

    try {
      if (SPREADSHEET_EXTS.includes(ext)) {
        // Parse spreadsheet locally with xlsx
        const buffer = await uploadFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length < 2) {
          setError("Spreadsheet has no data rows.");
          setParsing(false);
          return;
        }

        // Send the text content to Claude for intelligent parsing
        const textContent = rows
          .map((row) => row.map((cell: any) => String(cell ?? "")).join("\t"))
          .join("\n");

        const res = await fetch("/api/intake/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: textContent,
            propertyName: address || "Subject Property",
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to parse spreadsheet");
          setParsing(false);
          return;
        }

        applyParsedUnits(data.units || []);
        setParseSource(`Parsed ${data.units?.length || 0} units from ${uploadFile.name}`);
      } else if (IMAGE_EXTS.includes(ext)) {
        // Send image to Claude for OCR + parsing
        const buffer = await uploadFile.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );
        const mediaType =
          ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

        const res = await fetch("/api/intake/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isImage: true,
            imageData: base64,
            mediaType,
            propertyName: address || "Subject Property",
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to parse image");
          setParsing(false);
          return;
        }

        applyParsedUnits(data.units || []);
        setParseSource(
          `Parsed ${data.units?.length || 0} units from screenshot (${data.confidence} confidence)`
        );
      } else if (ext === "pdf") {
        // Read PDF as text and send to Claude
        const buffer = await uploadFile.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        // PDFs are sent as images to Claude (it can read them)
        const res = await fetch("/api/intake/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isImage: true,
            imageData: base64,
            mediaType: "application/pdf",
            propertyName: address || "Subject Property",
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to parse PDF");
          setParsing(false);
          return;
        }

        applyParsedUnits(data.units || []);
        setParseSource(
          `Parsed ${data.units?.length || 0} units from PDF (${data.confidence} confidence)`
        );
      }
    } catch (err: any) {
      setError(err.message || "Failed to parse file");
    } finally {
      setParsing(false);
    }
  }

  function applyParsedUnits(parsed: any[]) {
    if (!parsed.length) {
      setError("No units found in the file.");
      return;
    }

    const newUnits: UnitInput[] = parsed.map((u: any, i: number) => ({
      name: u.unit_number || u.suite || `Unit ${i + 1}`,
      sqft: u.square_footage ? String(u.square_footage) : "",
      leaseRate: u.lease_rate ? String(u.lease_rate) : "",
      leaseType: u.lease_type || "",
      monthlyRent: u.monthly_rent ? String(u.monthly_rent) : "",
      tenant: u.tenant_name || "",
      isVacant: !!u.is_vacant,
    }));

    setUnits(newUnits);
    setInputMode("manual"); // Switch to manual so they can see/edit the parsed data

    // Auto-calculate total SF if not set
    if (!totalSqft) {
      const total = newUnits.reduce((sum, u) => sum + (parseFloat(u.sqft) || 0), 0);
      if (total > 0) setTotalSqft(String(total));
    }

    // Auto-calculate income if not set
    if (!annualIncome) {
      const totalAnnual = parsed.reduce(
        (sum: number, u: any) =>
          sum + (u.annual_rent || (u.monthly_rent ? u.monthly_rent * 12 : 0)),
        0
      );
      if (totalAnnual > 0) {
        setAnnualIncome(String(Math.round(totalAnnual)));
        setShowIncome(true);
      }
    }

    // Calculate occupancy
    const totalUnits = parsed.length;
    const vacantUnits = parsed.filter((u: any) => u.is_vacant).length;
    if (totalUnits > 0 && !occupancy) {
      const occ = ((totalUnits - vacantUnits) / totalUnits) * 100;
      setOccupancy(String(Math.round(occ)));
    }
  }

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
      .map((u, i) => {
        const monthlyRent = u.monthlyRent ? parseFloat(u.monthlyRent) : null;
        const leaseRate = u.leaseRate ? parseFloat(u.leaseRate) : null;
        return {
          name: u.name || `Unit ${i + 1}`,
          sqft: parseFloat(u.sqft),
          tenant: u.tenant || null,
          isVacant: u.isVacant,
          leaseRate,
          monthlyRent,
          annualRent: monthlyRent ? monthlyRent * 12 : null,
        };
      });

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

  // ── Save to Pipeline (Property + optional Deal) ────────
  const saveValuation = async (addToDeals: boolean) => {
    if (!result?.valuation) return;
    setSaving(true);
    setSaveError("");
    setSavedTo(null);

    const v = result.valuation;
    const totalSF = v.subject.sqft || (totalSqft ? parseFloat(totalSqft) : undefined);
    const stabilizedValue = v.reconciledValue?.high || v.reconciledValue?.mid || null;
    const currentNOI = v.incomeApproach?.estimatedNOI ?? null;
    const stabilizedRate = v.incomeApproach?.estimatedMarketRent ?? null;
    const occupancyPct = occupancy ? parseFloat(occupancy) : null;
    const yearBuiltNum = yearBuilt ? parseInt(yearBuilt) : null;
    const pricePerSf = stabilizedValue && totalSF ? Math.round(stabilizedValue / totalSF) : null;

    try {
      const res = await fetch("/api/valuate/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: address.trim(),
          formattedAddress: v.subject.geocoded?.formattedAddress,
          city: v.subject.geocoded?.city,
          state: v.subject.geocoded?.state,
          assetType: v.subject.assetType || assetType || undefined,
          sqft: totalSF,
          yearBuilt: yearBuiltNum,
          occupancyPct,
          stabilizedValue,
          currentNOI,
          stabilizedRate,
          capRate: v.salesComparison?.avgCapRate ?? 0.075,
          pricePerSf,
          yourRole: saveRole,
          transactionType: saveTxn,
          addToDeals,
          notes: `Saved from valuation tool · ${new Date().toLocaleDateString()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Failed to save");
        return;
      }
      setSavedTo({ propertySlug: data.propertySlug, dealId: data.dealId });
    } catch (err: any) {
      setSaveError(err.message || "Network error");
    } finally {
      setSaving(false);
    }
  };

  // ── Reset ──────────────────────────────────────────────
  const reset = () => {
    setResult(null);
    setError("");
    setSavedTo(null);
    setSaveError("");
  };

  const v = result?.valuation;
  const ext = uploadFile ? fileExt(uploadFile.name) : "";
  const extIcon: Record<string, string> = {
    xlsx: "📊", xls: "📊", csv: "📊",
    jpg: "🖼️", jpeg: "🖼️", png: "🖼️", webp: "🖼️",
    pdf: "📄",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Property Valuation</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "rgba(240,237,228,0.45)" }}>
            Enter a property address and upload a rent roll or enter units manually
          </p>
        </div>
        {result && (
          <button style={btnSecondary} onClick={reset}>
            New Valuation
          </button>
        )}
      </div>

      {/* Form + Results layout */}
      <div style={{ display: "grid", gridTemplateColumns: result ? "420px 1fr" : "1fr", gap: 16 }}>
        {/* ── LEFT: Input Form ────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            </div>
          </Panel>

          {/* ── Unit Data: Toggle between manual and upload ─── */}
          <Panel
            title="Rent Roll / Unit Data"
            actions={
              <div style={{ display: "flex", gap: 2 }}>
                <button
                  onClick={() => setInputMode("manual")}
                  style={{
                    ...tabBtnStyle,
                    background: inputMode === "manual" ? "rgba(224,122,95,0.15)" : "transparent",
                    color: inputMode === "manual" ? "#E07A5F" : "rgba(240,237,228,0.4)",
                  }}
                >
                  Manual
                </button>
                <button
                  onClick={() => setInputMode("upload")}
                  style={{
                    ...tabBtnStyle,
                    background: inputMode === "upload" ? "rgba(224,122,95,0.15)" : "transparent",
                    color: inputMode === "upload" ? "#E07A5F" : "rgba(240,237,228,0.4)",
                  }}
                >
                  Upload
                </button>
              </div>
            }
          >
            {inputMode === "upload" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Drop zone */}
                <div
                  onDrop={onDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragging ? "rgba(224,122,95,0.6)" : "rgba(255,255,255,0.08)"}`,
                    borderRadius: 6,
                    padding: uploadFile ? "14px 16px" : "32px 16px",
                    textAlign: "center",
                    cursor: parsing ? "default" : "pointer",
                    transition: "all 0.2s",
                    background: dragging ? "rgba(224,122,95,0.04)" : "rgba(255,255,255,0.015)",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp,.pdf"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                    disabled={parsing}
                  />

                  {uploadFile ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 22 }}>{extIcon[ext] || "📎"}</span>
                      <div style={{ flex: 1, textAlign: "left" }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{uploadFile.name}</div>
                        <div style={{ fontSize: 11, color: "rgba(240,237,228,0.4)", marginTop: 2 }}>
                          {fileSize(uploadFile.size)} &middot; {ext.toUpperCase()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadFile(null);
                          setParseSource("");
                        }}
                        className="icon-btn"
                        style={{ fontSize: 12 }}
                        disabled={parsing}
                      >
                        x
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.4 }}>📂</div>
                      <div style={{ fontSize: 12, color: "rgba(240,237,228,0.6)", marginBottom: 4 }}>
                        Drag & drop a file here, or{" "}
                        <span style={{ color: "#E07A5F", fontWeight: 600 }}>browse</span>
                      </div>
                      <div style={{ fontSize: 10.5, color: "rgba(240,237,228,0.35)" }}>
                        Excel, CSV, PDF, or screenshot/image &middot; Max 10 MB
                      </div>
                    </>
                  )}
                </div>

                {/* Parse button */}
                {uploadFile && !parseSource && (
                  <button
                    style={{
                      ...btnPrimary,
                      opacity: parsing ? 0.7 : 1,
                      pointerEvents: parsing ? "none" : "auto",
                    }}
                    onClick={parseUploadedFile}
                    disabled={parsing}
                  >
                    {parsing
                      ? IMAGE_EXTS.includes(ext) || ext === "pdf"
                        ? "Claude is reading the file..."
                        : "Parsing spreadsheet..."
                      : IMAGE_EXTS.includes(ext) || ext === "pdf"
                        ? "Extract Data with AI"
                        : "Parse Spreadsheet"}
                  </button>
                )}

                {/* Parse result badge */}
                {parseSource && (
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "rgba(34,197,94,0.08)",
                      border: "1px solid rgba(34,197,94,0.2)",
                      borderRadius: 5,
                      fontSize: 11.5,
                      color: "#22c55e",
                    }}
                  >
                    {parseSource} &mdash; review below and run valuation
                  </div>
                )}
              </div>
            ) : (
              /* ── Manual unit entry ────────────────────────── */
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 10.5, color: "rgba(240,237,228,0.35)" }}>
                    {units.length} unit{units.length !== 1 ? "s" : ""}
                  </span>
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

                {/* Column headers */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 70px 70px 28px",
                    gap: 6,
                    marginBottom: 4,
                  }}
                >
                  <span style={colHeaderStyle}>Unit / Tenant</span>
                  <span style={colHeaderStyle}>SF</span>
                  <span style={colHeaderStyle}>$/SF</span>
                  <span />
                </div>

                {units.map((unit, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 70px 70px 28px",
                      gap: 6,
                      marginBottom: 5,
                    }}
                  >
                    <input
                      style={{ ...inputStyle, fontSize: 11 }}
                      placeholder={unit.tenant || `Unit ${idx + 1}`}
                      value={unit.name}
                      onChange={(e) => updateUnit(idx, "name", e.target.value)}
                    />
                    <input
                      style={{ ...inputStyle, fontSize: 11 }}
                      type="number"
                      placeholder="SF"
                      value={unit.sqft}
                      onChange={(e) => updateUnit(idx, "sqft", e.target.value)}
                    />
                    <input
                      style={{ ...inputStyle, fontSize: 11 }}
                      type="number"
                      placeholder="$/SF"
                      value={unit.leaseRate}
                      onChange={(e) => updateUnit(idx, "leaseRate", e.target.value)}
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
            )}
          </Panel>

          {/* ── Income Details (collapsible) ────────────────── */}
          <Panel
            title="Income Details"
            actions={
              <button
                onClick={() => setShowIncome(!showIncome)}
                style={{
                  ...tabBtnStyle,
                  color: "rgba(240,237,228,0.4)",
                }}
              >
                {showIncome ? "Hide" : "Show"}
              </button>
            }
          >
            {showIncome ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <FormField label="Annual Income">
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
            ) : (
              <div style={{ fontSize: 11, color: "rgba(240,237,228,0.3)" }}>
                Optional — provide if available for more accurate income approach
              </div>
            )}
          </Panel>

          {/* Error */}
          {error && (
            <div
              style={{
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
                margin: "2px 0 0",
              }}
            >
              Geocoding address, pulling comps, running analysis...
            </p>
          )}
        </div>

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
                  <div style={approachBoxStyle}>
                    <div style={approachLabelStyle}>Income Approach</div>
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
                  <div style={approachBoxStyle}>
                    <div style={approachLabelStyle}>Sales Comparison</div>
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
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "left" }}>
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
                      <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                        <td style={tdStyle} title={c.address}>
                          <div style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.address}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          {c.distanceMiles != null ? c.distanceMiles.toFixed(1) + " mi" : "-"}
                        </td>
                        <td style={tdStyle}>{fmt$(c.salePrice)}</td>
                        <td style={tdStyle}>{fmtPsf(c.pricePsf)}</td>
                        <td style={tdStyle}>{c.capRate ? fmtPct(c.capRate) : "-"}</td>
                        <td style={tdStyle}>{c.sqft ? c.sqft.toLocaleString() : "-"}</td>
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

            {/* Save to Pipeline */}
            <Panel title="Save to Pipeline" actions={<span />}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 10, color: "rgba(240,237,228,0.5)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Your role
                  </label>
                  <select
                    value={saveRole}
                    onChange={(e) => setSaveRole(e.target.value)}
                    style={{ ...selectStyle, width: 180 }}
                    disabled={saving || !!savedTo}
                  >
                    <option value="listing_broker">Listing broker</option>
                    <option value="buyer_broker">Buyer broker</option>
                    <option value="owner">Owner</option>
                    <option value="investor">Investor</option>
                    <option value="advisor">Advisor</option>
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 10, color: "rgba(240,237,228,0.5)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Transaction
                  </label>
                  <select
                    value={saveTxn}
                    onChange={(e) => setSaveTxn(e.target.value)}
                    style={{ ...selectStyle, width: 140 }}
                    disabled={saving || !!savedTo}
                  >
                    <option value="sale">Sale</option>
                    <option value="lease">Lease</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={{ ...btnSecondary, opacity: savedTo ? 0.5 : 1 }}
                  onClick={() => saveValuation(false)}
                  disabled={saving || !!savedTo}
                >
                  {saving && !savedTo ? "Saving..." : "Save as Property"}
                </button>
                <button
                  style={{ ...btnPrimary, opacity: savedTo ? 0.5 : 1 }}
                  onClick={() => saveValuation(true)}
                  disabled={saving || !!savedTo}
                >
                  {saving && !savedTo ? "Saving..." : "Save & Add to Deals"}
                </button>
              </div>

              {saveError && (
                <p style={{ marginTop: 10, fontSize: 12, color: "#E07A5F" }}>{saveError}</p>
              )}
              {savedTo && (
                <div style={{ marginTop: 12, padding: 10, borderRadius: 4, background: "rgba(78,205,196,0.08)", border: "1px solid rgba(78,205,196,0.25)" }}>
                  <p style={{ fontSize: 12, color: "#4ECDC4", margin: 0, marginBottom: 6 }}>
                    ✓ Saved to your pipeline
                  </p>
                  <div style={{ fontSize: 12, color: "rgba(240,237,228,0.7)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <a href={`/properties/${savedTo.propertySlug}`} style={{ color: "#E07A5F", textDecoration: "underline" }}>
                      View property →
                    </a>
                    {savedTo.dealId && (
                      <a href={`/deals`} style={{ color: "#E07A5F", textDecoration: "underline" }}>
                        View in Deals pipeline →
                      </a>
                    )}
                  </div>
                </div>
              )}
            </Panel>

            {/* PDF Downloads */}
            <Panel title="Download Reports" actions={<span />}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { key: "sale-bov", label: "BOV Sale", file: "BOV_Sale" },
                  { key: "rental-opinion", label: "Rental Opinion", file: "Rental_Opinion" },
                  { key: "stabilized-valuation", label: "Stabilized Valuation", file: "Stabilized_Valuation" },
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

              {v.disclaimers && v.disclaimers.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {v.disclaimers.map((d: string, i: number) => (
                    <p
                      key={i}
                      style={{ fontSize: 10, color: "rgba(240,237,228,0.3)", margin: "4px 0", lineHeight: 1.4 }}
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

// ── Shared styles ─────────────────────────────────────────

const tabBtnStyle: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 4,
  border: "none",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 500,
  fontFamily: "inherit",
};

const colHeaderStyle: React.CSSProperties = {
  fontSize: 9.5,
  color: "rgba(240,237,228,0.3)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const approachBoxStyle: React.CSSProperties = {
  padding: 12,
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 5,
};

const approachLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(240,237,228,0.4)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 8,
};

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
