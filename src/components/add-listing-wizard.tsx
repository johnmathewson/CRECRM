"use client";
import { useState, useRef, useCallback } from "react";
import Modal, { FormField, inputStyle, selectStyle, btnPrimary, btnSecondary } from "./modal";
import ListingImageUploader, { type ListingImage } from "./listing-image-uploader";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ListingForm {
  name: string;
  headline: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  asset_type: string;
  transaction_type: string;
  status: string;
  your_role: string;
  asking_price: string;
  lease_rate: string;
  sqft: string;
  acreage: string;
  year_built: string;
  parking_spaces: string;
  parking_ratio: string;
  zoning: string;
  noi: string;
  cap_rate: string;
  price_per_sf: string;
  occupancy_pct: string;
  description: string;
  highlights: string;
  notes: string;
  crexi_url: string;
}

const emptyForm = (): ListingForm => ({
  name: "", headline: "", address: "", city: "", state: "IN", zip: "",
  asset_type: "retail", transaction_type: "sale", status: "listed",
  your_role: "listing_broker", asking_price: "", lease_rate: "",
  sqft: "", acreage: "", year_built: "", parking_spaces: "",
  parking_ratio: "", zoning: "", noi: "", cap_rate: "",
  price_per_sf: "", occupancy_pct: "", description: "",
  highlights: "", notes: "", crexi_url: "",
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const coral = "#E07A5F";
const cream = "#F0EDE4";
const creamMuted = "rgba(240,237,228,0.55)";
const creamSubtle = "rgba(240,237,228,0.35)";

const modeCard = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "18px 16px",
  borderRadius: 8,
  border: `1px solid ${active ? "rgba(224,122,95,0.5)" : "rgba(255,255,255,0.07)"}`,
  background: active ? "rgba(224,122,95,0.08)" : "rgba(255,255,255,0.02)",
  cursor: "pointer",
  transition: "all 0.18s",
  textAlign: "center" as const,
  boxShadow: active ? "0 0 0 1px rgba(224,122,95,0.3)" : "none",
});

const stepBadge = (active: boolean, done: boolean): React.CSSProperties => ({
  width: 24, height: 24, borderRadius: "50%",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 11, fontWeight: 700,
  background: done ? coral : active ? "rgba(224,122,95,0.2)" : "rgba(255,255,255,0.06)",
  color: done ? "white" : active ? coral : creamSubtle,
  border: `1px solid ${done ? coral : active ? "rgba(224,122,95,0.4)" : "rgba(255,255,255,0.08)"}`,
  flexShrink: 0,
});

const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
  textTransform: "uppercase" as const, color: coral,
  marginBottom: 12, marginTop: 20,
};

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" };
const grid3: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 14px" };
const grid4: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0 14px" };

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: number }) {
  const steps = ["Import", "Details", "Financials", "Description", "Publish"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24 }}>
      {steps.map((label, i) => {
        const num = i + 1;
        const active = num === step;
        const done = num < step;
        return (
          <div key={num} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={stepBadge(active, done)}>{done ? "✓" : num}</div>
              <span style={{ fontSize: 9.5, color: active ? coral : done ? creamMuted : creamSubtle, fontWeight: active ? 600 : 400, whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 1, background: done ? "rgba(224,122,95,0.4)" : "rgba(255,255,255,0.07)", margin: "0 6px", marginBottom: 16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (property: any) => void;
  organizationId: string;
}

type Mode = "crexi" | "om" | "manual";

export default function AddListingWizard({ open, onClose, onCreated, organizationId }: Props) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<Mode>("om");
  const [form, setForm] = useState<ListingForm>(emptyForm());
  const [crexiUrl, setCrexiUrl] = useState("");
  const [omFile, setOmFile] = useState<File | null>(null);
  const [omDragging, setOmDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | "">("");
  const [extractionNotes, setExtractionNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishToWebsite, setPublishToWebsite] = useState(true);
  const [publishToCrexi, setPublishToCrexi] = useState(false);
  const [images, setImages] = useState<ListingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof ListingForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Auto-calculate price per SF
  const handlePriceOrSF = (k: "asking_price" | "sqft", v: string) => {
    set(k, v);
    const price = k === "asking_price" ? parseFloat(v) : parseFloat(form.asking_price);
    const sf = k === "sqft" ? parseFloat(v) : parseFloat(form.sqft);
    if (price > 0 && sf > 0) set("price_per_sf", (price / sf).toFixed(2));
  };

  function reset() {
    setStep(1); setMode("om"); setForm(emptyForm());
    setCrexiUrl(""); setOmFile(null); setLoading(false);
    setConfidence(""); setExtractionNotes(""); setError(""); setSaving(false);
    setPublishToWebsite(true); setPublishToCrexi(false);
    setImages([]);
  }

  function handleClose() { reset(); onClose(); }

  // ── File drop handling ────────────────────────────────────────────────────

  const handleOmFile = (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "doc", "docx", "jpg", "jpeg", "png"].includes(ext)) {
      setError("Unsupported file type. Use PDF, Word, or image."); return;
    }
    // PDFs upload to Supabase Storage (50 MB cap). Images are base64-inlined
    // in the JSON body (4 MB safe under Netlify's 6 MB function limit).
    if (ext === "pdf" && f.size > 50 * 1024 * 1024) {
      setError("PDF too large — max 50 MB."); return;
    }
    if (["jpg", "jpeg", "png"].includes(ext) && f.size > 4 * 1024 * 1024) {
      setError("Image too large — max 4 MB."); return;
    }
    setError(""); setOmFile(f);
  };

  // FileReader-based base64 (efficient for large files; the manual loop
  // approach is O(n²) and crashes on multi-MB PDFs).
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] || "";
        resolve(base64);
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }

  // ── Step 1: Import mode selection & trigger ───────────────────────────────

  async function handleImport() {
    setError("");
    if (mode === "manual") { setStep(2); return; }

    if (mode === "crexi" && !crexiUrl.trim()) {
      setError("Please paste a CREXi listing URL."); return;
    }
    if (mode === "om" && !omFile) {
      setError("Please upload an OM or brochure file."); return;
    }

    setLoading(true);

    try {
      let text = "";
      let isImage = false;
      let imageData = "";
      let pdfUrl = "";
      let mediaType = "";

      if (mode === "crexi") {
        // Fetch CREXi page text via our proxy
        setLoadingMsg("Fetching CREXi listing...");
        const res = await fetch("/api/properties/scrape-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: crexiUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch listing page");
        text = data.text;
      } else if (mode === "om") {
        const ext = omFile!.name.split(".").pop()?.toLowerCase() || "";
        if (["jpg", "jpeg", "png"].includes(ext)) {
          setLoadingMsg("Reading image...");
          imageData = await fileToBase64(omFile!);
          mediaType = ext === "png" ? "image/png" : "image/jpeg";
          isImage = true;
        } else if (ext === "pdf") {
          // Upload to Supabase Storage (private bucket), then hand Claude a
          // signed URL — bypasses Netlify's 6 MB function payload limit.
          setLoadingMsg("Uploading PDF...");
          const supabase = createSupabaseClient();
          const ts = Date.now();
          const rand = Math.random().toString(36).slice(2, 8);
          const safeName = omFile!.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
          const path = `${ts}-${rand}-${safeName}`;
          const { error: upErr } = await supabase.storage
            .from("listing-documents")
            .upload(path, omFile!, { contentType: "application/pdf", upsert: false });
          if (upErr) throw new Error(`PDF upload failed: ${upErr.message}`);
          // 10-minute signed URL — long enough for Claude to fetch + parse.
          const { data: signed, error: signErr } = await supabase.storage
            .from("listing-documents")
            .createSignedUrl(path, 600);
          if (signErr || !signed?.signedUrl) {
            throw new Error(`Could not create signed URL: ${signErr?.message || "unknown"}`);
          }
          pdfUrl = signed.signedUrl;
        } else {
          throw new Error("Word document support is coming soon. For now, please convert to PDF or paste a CREXi URL.");
        }
      }

      setLoadingMsg("Claude is reading the listing...");
      const parseRes = await fetch("/api/properties/parse-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text || undefined,
          isImage: isImage || undefined,
          imageData: imageData || undefined,
          mediaType: mediaType || undefined,
          pdfUrl: pdfUrl || undefined,
          sourceUrl: mode === "crexi" ? crexiUrl : undefined,
        }),
      });

      const parseRaw = await parseRes.text();
      let parseData: any;
      try {
        parseData = parseRaw ? JSON.parse(parseRaw) : {};
      } catch {
        throw new Error(
          parseRes.ok
            ? "AI extraction returned an invalid response. Please try again."
            : `AI extraction failed (status ${parseRes.status}). The function may have timed out — try a smaller PDF.`
        );
      }
      if (!parseRes.ok) throw new Error(parseData.error || `AI extraction failed (status ${parseRes.status})`);

      // Populate form with extracted data
      const p = parseData.property || {};
      setForm(f => ({
        ...f,
        name: p.name || f.name,
        headline: p.headline || f.headline,
        address: p.address || f.address,
        city: p.city || f.city,
        state: p.state || f.state,
        zip: p.zip || f.zip,
        asset_type: p.asset_type || f.asset_type,
        transaction_type: p.transaction_type || f.transaction_type,
        status: p.status || f.status,
        your_role: p.your_role || f.your_role,
        asking_price: p.asking_price ? String(p.asking_price) : f.asking_price,
        lease_rate: p.lease_rate ? String(p.lease_rate) : f.lease_rate,
        sqft: p.sqft ? String(p.sqft) : f.sqft,
        acreage: p.acreage ? String(p.acreage) : f.acreage,
        year_built: p.year_built ? String(p.year_built) : f.year_built,
        parking_spaces: p.parking_spaces ? String(p.parking_spaces) : f.parking_spaces,
        parking_ratio: p.parking_ratio || f.parking_ratio,
        zoning: p.zoning || f.zoning,
        noi: p.noi ? String(p.noi) : f.noi,
        cap_rate: p.cap_rate ? String(p.cap_rate) : f.cap_rate,
        price_per_sf: p.price_per_sf ? String(p.price_per_sf) : f.price_per_sf,
        occupancy_pct: p.occupancy_pct ? String(p.occupancy_pct) : f.occupancy_pct,
        description: p.description || f.description,
        highlights: Array.isArray(p.highlights) ? p.highlights.join("\n") : f.highlights,
        notes: p.notes || f.notes,
        crexi_url: mode === "crexi" ? crexiUrl : f.crexi_url,
      }));

      setConfidence(parseData.confidence || "medium");
      setExtractionNotes(parseData.extraction_notes || "");
      setStep(2);
    } catch (e: any) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  }

  // ── Save to Supabase ──────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) { setError("Property name is required."); return; }
    setSaving(true); setError("");
    try {
      const payload = {
        organization_id: organizationId,
        name: form.name.trim(),
        headline: form.headline.trim() || null,
        images: images.length > 0 ? images : null,
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        zip: form.zip.trim(),
        asset_type: form.asset_type,
        transaction_type: form.transaction_type,
        status: form.status,
        your_role: form.your_role,
        asking_price: form.asking_price ? parseFloat(form.asking_price) : null,
        lease_rate: form.lease_rate ? parseFloat(form.lease_rate) : null,
        sqft: form.sqft ? parseInt(form.sqft) : null,
        acreage: form.acreage ? parseFloat(form.acreage) : null,
        year_built: form.year_built ? parseInt(form.year_built) : null,
        parking_spaces: form.parking_spaces ? parseInt(form.parking_spaces) : null,
        parking_ratio: form.parking_ratio || null,
        zoning: form.zoning || null,
        noi: form.noi ? parseFloat(form.noi) : null,
        cap_rate: form.cap_rate ? parseFloat(form.cap_rate) : null,
        price_per_sf: form.price_per_sf ? parseFloat(form.price_per_sf) : null,
        occupancy_pct: form.occupancy_pct ? parseFloat(form.occupancy_pct) : null,
        description: form.description || null,
        highlights: form.highlights
          ? form.highlights.split("\n").map(h => h.trim()).filter(Boolean)
          : null,
        notes: form.notes || null,
        crexi_url: form.crexi_url || null,
        publish_to_website: publishToWebsite,
        crexi_sync_status: publishToCrexi ? "pending" : "not_synced",
        source_import: mode !== "manual" ? mode : null,
      };

      const res = await fetch("/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create property");
      onCreated(data.property || data);
      reset();
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
      }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="glass"
        style={{ width: 720, maxHeight: "90vh", overflow: "auto", animation: "fadeIn 0.15s ease" }}
      >
        {/* Header */}
        <div className="panel-header">
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Add New Listing</h3>
          <button onClick={handleClose} className="icon-btn" style={{ fontSize: 14 }}>✕</button>
        </div>

        <div style={{ padding: "20px 24px 24px" }}>
          <StepIndicator step={step} />

          {/* ── STEP 1: Import Mode ── */}
          {step === 1 && (
            <div>
              <p style={{ fontSize: 12.5, color: creamMuted, margin: "0 0 20px" }}>
                How would you like to add this listing? Choose an import method or enter details manually.
              </p>

              {/* Mode cards */}
              <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                {/* CREXi URL */}
                <div style={modeCard(mode === "crexi")} onClick={() => setMode("crexi")}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🔗</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: mode === "crexi" ? coral : cream, marginBottom: 4 }}>
                    Import from CREXi
                  </div>
                  <div style={{ fontSize: 10.5, color: creamSubtle, lineHeight: 1.5 }}>
                    Paste a CREXi listing URL — AI extracts all details automatically
                  </div>
                </div>

                {/* OM Upload */}
                <div style={modeCard(mode === "om")} onClick={() => setMode("om")}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: mode === "om" ? coral : cream, marginBottom: 4 }}>
                    Upload OM / Brochure
                  </div>
                  <div style={{ fontSize: 10.5, color: creamSubtle, lineHeight: 1.5 }}>
                    Upload a PDF or Word doc — Claude reads it and fills in all fields
                  </div>
                </div>

                {/* Manual */}
                <div style={modeCard(mode === "manual")} onClick={() => setMode("manual")}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>✏️</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: mode === "manual" ? coral : cream, marginBottom: 4 }}>
                    Enter Manually
                  </div>
                  <div style={{ fontSize: 10.5, color: creamSubtle, lineHeight: 1.5 }}>
                    Fill in the listing details yourself step by step
                  </div>
                </div>
              </div>

              {/* CREXi URL input */}
              {mode === "crexi" && (
                <div style={{ marginBottom: 16 }}>
                  <FormField label="CREXi Listing URL">
                    <input
                      style={inputStyle}
                      placeholder="https://www.crexi.com/properties/2475490/indiana-super-8-by-wyndham-valparaiso"
                      value={crexiUrl}
                      onChange={e => setCrexiUrl(e.target.value)}
                    />
                  </FormField>
                  <p style={{ fontSize: 11, color: creamSubtle, margin: "4px 0 0" }}>
                    Paste any public CREXi property URL. Claude will extract the full listing details.
                  </p>
                </div>
              )}

              {/* OM Upload drop zone */}
              {mode === "om" && (
                <div style={{ marginBottom: 16 }}>
                  <div
                    onDrop={e => { e.preventDefault(); setOmDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleOmFile(f); }}
                    onDragOver={e => { e.preventDefault(); setOmDragging(true); }}
                    onDragLeave={() => setOmDragging(false)}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: `2px dashed ${omDragging ? "rgba(224,122,95,0.6)" : omFile ? "rgba(224,122,95,0.35)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 8, padding: omFile ? "16px 20px" : "40px 20px",
                      textAlign: "center", cursor: "pointer", transition: "all 0.2s",
                      background: omDragging ? "rgba(224,122,95,0.05)" : omFile ? "rgba(224,122,95,0.03)" : "rgba(255,255,255,0.015)",
                    }}
                  >
                    <input
                      ref={fileInputRef} type="file"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleOmFile(f); }}
                    />
                    {omFile ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 28 }}>📄</span>
                        <div style={{ textAlign: "left", flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: cream }}>{omFile.name}</div>
                          <div style={{ fontSize: 11, color: creamSubtle, marginTop: 2 }}>
                            {(omFile.size / 1024 / 1024).toFixed(1)} MB · Ready to analyze
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); setOmFile(null); }}
                          className="icon-btn" style={{ fontSize: 12 }}
                        >✕</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.4 }}>📂</div>
                        <div style={{ fontSize: 13, color: creamMuted, marginBottom: 4 }}>
                          Drag & drop your OM or brochure here, or{" "}
                          <span style={{ color: coral, fontWeight: 600 }}>browse</span>
                        </div>
                        <div style={{ fontSize: 11, color: creamSubtle }}>
                          PDF, Word, or image · Max 20 MB
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {error && <div style={{ fontSize: 12, color: coral, marginBottom: 12, fontWeight: 500 }}>{error}</div>}

              {loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "rgba(224,122,95,0.06)", borderRadius: 6, marginBottom: 16 }}>
                  <div style={{ fontSize: 18 }}>✨</div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: cream }}>{loadingMsg || "Processing..."}</div>
                    <div style={{ fontSize: 11, color: creamSubtle, marginTop: 2 }}>Claude is reading your document</div>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button style={btnSecondary} onClick={handleClose}>Cancel</button>
                <button
                  style={{ ...btnPrimary, opacity: loading ? 0.5 : 1 }}
                  onClick={handleImport}
                  disabled={loading}
                >
                  {loading ? "Processing..." : mode === "manual" ? "Continue →" : "✨ Extract with AI →"}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Property Details ── */}
          {step === 2 && (
            <div>
              {confidence && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px",
                  background: confidence === "high" ? "rgba(107,203,119,0.08)" : confidence === "medium" ? "rgba(242,201,76,0.08)" : "rgba(224,122,95,0.08)",
                  border: `1px solid ${confidence === "high" ? "rgba(107,203,119,0.2)" : confidence === "medium" ? "rgba(242,201,76,0.2)" : "rgba(224,122,95,0.2)"}`,
                  borderRadius: 6, marginBottom: 16,
                }}>
                  <span style={{ fontSize: 16 }}>{confidence === "high" ? "✅" : confidence === "medium" ? "⚠️" : "🔍"}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: cream }}>
                      AI extraction confidence: <span style={{ textTransform: "capitalize" }}>{confidence}</span>
                    </div>
                    {extractionNotes && (
                      <div style={{ fontSize: 11, color: creamMuted, marginTop: 3 }}>{extractionNotes}</div>
                    )}
                  </div>
                </div>
              )}

              <div style={sectionLabel}>Property Identity</div>
              <FormField label="Property Name * (internal)">
                <input style={inputStyle} value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Liberty Square Shopping Center" />
              </FormField>
              <FormField label="Public Headline (marketing-friendly title shown on stewardshipcre.com)">
                <input style={inputStyle} value={form.headline} onChange={e => set("headline", e.target.value)} placeholder="e.g. Anchored Retail Center — Strong Cash Flow" />
              </FormField>
              <div style={grid2}>
                <FormField label="Street Address">
                  <input style={inputStyle} value={form.address} onChange={e => set("address", e.target.value)} placeholder="3005 John Howell Dr" />
                </FormField>
                <FormField label="City">
                  <input style={inputStyle} value={form.city} onChange={e => set("city", e.target.value)} placeholder="Valparaiso" />
                </FormField>
              </div>
              <div style={grid3}>
                <FormField label="State">
                  <input style={inputStyle} value={form.state} onChange={e => set("state", e.target.value)} placeholder="IN" />
                </FormField>
                <FormField label="Zip">
                  <input style={inputStyle} value={form.zip} onChange={e => set("zip", e.target.value)} placeholder="46383" />
                </FormField>
                <FormField label="Zoning">
                  <input style={inputStyle} value={form.zoning} onChange={e => set("zoning", e.target.value)} placeholder="C-2" />
                </FormField>
              </div>

              <div style={sectionLabel}>Listing Classification</div>
              <div style={grid3}>
                <FormField label="Asset Type">
                  <select style={selectStyle} value={form.asset_type} onChange={e => set("asset_type", e.target.value)}>
                    {["retail","office","industrial","multifamily","hotel","land","mixed_use","restaurant","medical","flex"].map(t => (
                      <option key={t} value={t}>{t.replace(/_/g," ")}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Transaction Type">
                  <select style={selectStyle} value={form.transaction_type} onChange={e => set("transaction_type", e.target.value)}>
                    <option value="sale">For Sale</option>
                    <option value="lease">For Lease</option>
                    <option value="sale_or_lease">Sale or Lease</option>
                  </select>
                </FormField>
                <FormField label="Your Role">
                  <select style={selectStyle} value={form.your_role} onChange={e => set("your_role", e.target.value)}>
                    {["listing_broker","buyer_rep","dual_agent","referral","consulting"].map(r => (
                      <option key={r} value={r}>{r.replace(/_/g," ")}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div style={grid2}>
                <FormField label="Listing Status">
                  <select style={selectStyle} value={form.status} onChange={e => set("status", e.target.value)}>
                    {["idea","pre_listing","listed","under_contract","sold","for_lease","leased","off_market"].map(s => (
                      <option key={s} value={s}>{s.replace(/_/g," ")}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="CREXi Listing URL (optional)">
                  <input style={inputStyle} value={form.crexi_url} onChange={e => set("crexi_url", e.target.value)} placeholder="https://www.crexi.com/properties/..." />
                </FormField>
              </div>

              <div style={sectionLabel}>Physical Details</div>
              <div style={grid4}>
                <FormField label="Building SF">
                  <input style={inputStyle} type="number" value={form.sqft} onChange={e => handlePriceOrSF("sqft", e.target.value)} placeholder="48000" />
                </FormField>
                <FormField label="Acreage">
                  <input style={inputStyle} type="number" step="0.01" value={form.acreage} onChange={e => set("acreage", e.target.value)} placeholder="2.4" />
                </FormField>
                <FormField label="Year Built">
                  <input style={inputStyle} type="number" value={form.year_built} onChange={e => set("year_built", e.target.value)} placeholder="1998" />
                </FormField>
                <FormField label="Occupancy %">
                  <input style={inputStyle} type="number" step="0.1" value={form.occupancy_pct} onChange={e => set("occupancy_pct", e.target.value)} placeholder="92.0" />
                </FormField>
              </div>
              <div style={grid2}>
                <FormField label="Parking Spaces">
                  <input style={inputStyle} type="number" value={form.parking_spaces} onChange={e => set("parking_spaces", e.target.value)} placeholder="200" />
                </FormField>
                <FormField label="Parking Ratio">
                  <input style={inputStyle} value={form.parking_ratio} onChange={e => set("parking_ratio", e.target.value)} placeholder="4.5/1,000 SF" />
                </FormField>
              </div>

              {error && <div style={{ fontSize: 12, color: coral, marginBottom: 12, fontWeight: 500 }}>{error}</div>}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
                <button style={btnSecondary} onClick={() => setStep(1)}>← Back</button>
                <button style={btnPrimary} onClick={() => setStep(3)}>Next: Financials →</button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Financials ── */}
          {step === 3 && (
            <div>
              <div style={sectionLabel}>Pricing</div>
              <div style={grid4}>
                <FormField label="Asking Price ($)">
                  <input style={inputStyle} type="number" value={form.asking_price} onChange={e => handlePriceOrSF("asking_price", e.target.value)} placeholder="5500000" />
                </FormField>
                <FormField label="Price Per SF ($)">
                  <input style={inputStyle} type="number" step="0.01" value={form.price_per_sf} onChange={e => set("price_per_sf", e.target.value)} placeholder="Auto-calc" />
                </FormField>
                <FormField label="Lease Rate ($/SF/yr)">
                  <input style={inputStyle} type="number" step="0.01" value={form.lease_rate} onChange={e => set("lease_rate", e.target.value)} placeholder="14.50" />
                </FormField>
                <FormField label="Occupancy %">
                  <input style={inputStyle} type="number" step="0.1" value={form.occupancy_pct} onChange={e => set("occupancy_pct", e.target.value)} placeholder="92.0" />
                </FormField>
              </div>

              <div style={sectionLabel}>Investment Metrics</div>
              <div style={grid3}>
                <FormField label="NOI ($/yr)">
                  <input style={inputStyle} type="number" value={form.noi} onChange={e => set("noi", e.target.value)} placeholder="330000" />
                </FormField>
                <FormField label="Cap Rate (%)">
                  <input style={inputStyle} type="number" step="0.01" value={form.cap_rate} onChange={e => set("cap_rate", e.target.value)} placeholder="6.0" />
                </FormField>
                <FormField label="Lease Type">
                  <select style={selectStyle} value={form.notes.includes("NNN") ? "NNN" : "Gross"} onChange={() => {}}>
                    <option value="NNN">NNN</option>
                    <option value="Gross">Gross</option>
                    <option value="Modified Gross">Modified Gross</option>
                    <option value="NN">NN (Double Net)</option>
                  </select>
                </FormField>
              </div>

              {error && <div style={{ fontSize: 12, color: coral, marginBottom: 12, fontWeight: 500 }}>{error}</div>}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
                <button style={btnSecondary} onClick={() => setStep(2)}>← Back</button>
                <button style={btnPrimary} onClick={() => setStep(4)}>Next: Description →</button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Description & Highlights ── */}
          {step === 4 && (
            <div>
              <div style={sectionLabel}>Listing Description</div>
              <p style={{ fontSize: 11.5, color: creamSubtle, margin: "0 0 10px" }}>
                {mode !== "manual" ? "Claude drafted this description from your document. Edit as needed." : "Write a compelling property description for your listing."}
              </p>
              <FormField label="Description">
                <textarea
                  style={{ ...inputStyle, minHeight: 100, resize: "vertical", lineHeight: 1.6 }}
                  value={form.description}
                  onChange={e => set("description", e.target.value)}
                  placeholder="Describe the property — location, key features, investment thesis, tenant profile..."
                />
              </FormField>

              <div style={sectionLabel}>Key Highlights</div>
              <p style={{ fontSize: 11.5, color: creamSubtle, margin: "0 0 10px" }}>
                One highlight per line. These appear as bullet points on your website and in the OM.
              </p>
              <FormField label="Highlights (one per line)">
                <textarea
                  style={{ ...inputStyle, minHeight: 100, resize: "vertical", lineHeight: 1.8 }}
                  value={form.highlights}
                  onChange={e => set("highlights", e.target.value)}
                  placeholder={"NNN Lease Structure\nHigh traffic count — 45,000 VPD\nCorner lot with excellent visibility\nRecent roof replacement (2022)\nStrong anchor tenant in place"}
                />
              </FormField>

              <FormField label="Internal Notes (not published)">
                <textarea
                  style={{ ...inputStyle, minHeight: 60, resize: "vertical" }}
                  value={form.notes}
                  onChange={e => set("notes", e.target.value)}
                  placeholder="Private notes for your CRM — seller motivation, deal history, etc."
                />
              </FormField>

              <div style={sectionLabel}>Photos</div>
              <p style={{ fontSize: 11.5, color: creamSubtle, margin: "0 0 10px" }}>
                These appear on the public listing page. The first image is used as the hero.
              </p>
              <ListingImageUploader value={images} onChange={setImages} />

              {error && <div style={{ fontSize: 12, color: coral, marginBottom: 12, marginTop: 12, fontWeight: 500 }}>{error}</div>}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 16 }}>
                <button style={btnSecondary} onClick={() => setStep(3)}>← Back</button>
                <button style={btnPrimary} onClick={() => setStep(5)}>Next: Publish →</button>
              </div>
            </div>
          )}

          {/* ── STEP 5: Publish ── */}
          {step === 5 && (
            <div>
              <div style={sectionLabel}>Syndication</div>
              <p style={{ fontSize: 12.5, color: creamMuted, margin: "0 0 16px" }}>
                Choose where to publish this listing. You can always change this later.
              </p>

              {/* Publish options */}
              {[
                {
                  key: "website",
                  icon: "🌐",
                  title: "Stewardship CRE Website",
                  desc: "Publish to stewardshipcre.com/properties — visible to all visitors",
                  value: publishToWebsite,
                  toggle: () => setPublishToWebsite(v => !v),
                  badge: "Live",
                  badgeColor: "#6BCB77",
                },
                {
                  key: "crexi",
                  icon: "🏢",
                  title: "CREXi",
                  desc: "Push to CREXi via API (requires CREXi API token in settings)",
                  value: publishToCrexi,
                  toggle: () => setPublishToCrexi(v => !v),
                  badge: "API",
                  badgeColor: coral,
                },
              ].map(opt => (
                <div
                  key={opt.key}
                  onClick={opt.toggle}
                  style={{
                    display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                    borderRadius: 8, marginBottom: 10, cursor: "pointer",
                    border: `1px solid ${opt.value ? "rgba(224,122,95,0.3)" : "rgba(255,255,255,0.07)"}`,
                    background: opt.value ? "rgba(224,122,95,0.05)" : "rgba(255,255,255,0.02)",
                    transition: "all 0.18s",
                  }}
                >
                  <span style={{ fontSize: 22 }}>{opt.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: cream }}>{opt.title}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: `${opt.badgeColor}22`, color: opt.badgeColor }}>
                        {opt.badge}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: creamSubtle, marginTop: 2 }}>{opt.desc}</div>
                  </div>
                  <div style={{
                    width: 36, height: 20, borderRadius: 10,
                    background: opt.value ? coral : "rgba(255,255,255,0.1)",
                    position: "relative", transition: "background 0.2s", flexShrink: 0,
                  }}>
                    <div style={{
                      position: "absolute", top: 2,
                      left: opt.value ? 18 : 2,
                      width: 16, height: 16, borderRadius: "50%",
                      background: "white", transition: "left 0.2s",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                    }} />
                  </div>
                </div>
              ))}

              {/* CoStar reminder */}
              <div style={{
                padding: "12px 14px", borderRadius: 6, marginTop: 4, marginBottom: 20,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>📋</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: creamMuted }}>CoStar / LoopNet</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,0.06)", color: creamSubtle }}>
                    Manual
                  </span>
                </div>
                <div style={{ fontSize: 11, color: creamSubtle, lineHeight: 1.5 }}>
                  CoStar does not allow third-party API publishing. After saving here, you'll receive a reminder to manually enter this listing in CoStar/LoopNet.
                </div>
              </div>

              {/* Summary */}
              <div style={{ padding: "14px 16px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: creamSubtle, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Listing Summary</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }}>
                  {[
                    ["Name", form.name || "—"],
                    ["Address", [form.address, form.city, form.state].filter(Boolean).join(", ") || "—"],
                    ["Type", form.asset_type.replace(/_/g, " ")],
                    ["Transaction", form.transaction_type.replace(/_/g, " ")],
                    ["Asking Price", form.asking_price ? `$${parseInt(form.asking_price).toLocaleString()}` : "—"],
                    ["SF", form.sqft ? parseInt(form.sqft).toLocaleString() : "—"],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: 10, color: creamSubtle, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                      <div style={{ fontSize: 12, color: cream, fontWeight: 500, marginTop: 1 }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {error && <div style={{ fontSize: 12, color: coral, marginBottom: 12, fontWeight: 500 }}>{error}</div>}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <button style={btnSecondary} onClick={() => setStep(4)}>← Back</button>
                <button
                  style={{ ...btnPrimary, opacity: saving ? 0.5 : 1, minWidth: 140 }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Saving..." : "✓ Save Listing"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
