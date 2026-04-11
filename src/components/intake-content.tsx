"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import Panel, { IconBtn } from "./panel";
import IntakeUploadZone from "./intake-upload-zone";
import IntakeEditableTable, { IntakeUnit } from "./intake-editable-table";
import IntakeSummary from "./intake-summary";
import IntakeComparison from "./intake-comparison";
import { btnPrimary, btnSecondary } from "./modal";

// ── Types ──────────────────────────────────────────────────
type Phase = "upload" | "processing" | "review" | "saved";

interface SavedIntake {
  id: string;
  property_name: string;
  file_name: string | null;
  status: string;
  created_at: string;
  unit_count?: number;
}

// ── Component ──────────────────────────────────────────────
export default function IntakeContent() {
  const [phase, setPhase] = useState<Phase>("upload");
  const [units, setUnits] = useState<IntakeUnit[]>([]);
  const [propertyName, setPropertyName] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");
  const [rawText, setRawText] = useState("");
  const [confidence, setConfidence] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [previousIntakes, setPreviousIntakes] = useState<SavedIntake[]>([]);
  const [loadingPrevious, setLoadingPrevious] = useState(true);

  // Load previous intakes
  const loadPrevious = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("intakes")
      .select("id, property_name, file_name, status, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    if (data) {
      // Get unit counts
      const intakes: SavedIntake[] = [];
      for (const intake of data) {
        const { count } = await supabase
          .from("intake_units")
          .select("id", { count: "exact", head: true })
          .eq("intake_id", intake.id);
        intakes.push({ ...intake, unit_count: count || 0 });
      }
      setPreviousIntakes(intakes);
    }
    setLoadingPrevious(false);
  }, []);

  useEffect(() => {
    loadPrevious();
  }, [loadPrevious]);

  // Load a saved intake for review
  const loadIntake = useCallback(async (intakeId: string) => {
    const supabase = createClient();
    const { data: intake } = await supabase
      .from("intakes")
      .select("*")
      .eq("id", intakeId)
      .single();

    if (!intake) return;

    const { data: unitData } = await supabase
      .from("intake_units")
      .select("*")
      .eq("intake_id", intakeId)
      .order("sort_order", { ascending: true });

    setPropertyName(intake.property_name);
    setFileName(intake.file_name || "");
    setFileType(intake.file_type || "");
    setRawText(intake.raw_extracted_text || "");
    setConfidence(intake.claude_raw_response?.confidence || "");
    setAiNotes(intake.claude_raw_response?.notes || "");
    setUnits(
      (unitData || []).map((u: any) => ({
        unit_number: u.unit_number,
        tenant_name: u.tenant_name,
        suite: u.suite,
        square_footage: u.square_footage ? Number(u.square_footage) : null,
        lease_rate: u.lease_rate ? Number(u.lease_rate) : null,
        lease_type: u.lease_type,
        lease_start: u.lease_start,
        lease_end: u.lease_end,
        monthly_rent: u.monthly_rent ? Number(u.monthly_rent) : null,
        annual_rent: u.annual_rent ? Number(u.annual_rent) : null,
        escalation_pct: u.escalation_pct ? Number(u.escalation_pct) : null,
        is_vacant: u.is_vacant || false,
        notes: u.notes,
      }))
    );
    setSavedId(intakeId);
    setPhase("review");
  }, []);

  // Upload & analyze
  const handleAnalyze = useCallback(async (file: File, name: string) => {
    setError("");
    setPhase("processing");
    setPropertyName(name);
    setFileName(file.name);
    setFileType(file.name.split(".").pop()?.toLowerCase() || "");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("propertyName", name);

      const res = await fetch("/api/intake/parse", {
        method: "POST",
        body: formData,
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { setError("Server error — the function may have timed out. Try again."); setPhase("upload"); return; }

      if (!res.ok) {
        setError(data.error || "Analysis failed");
        setPhase("upload");
        return;
      }

      setUnits(data.units || []);
      setConfidence(data.confidence || "");
      setAiNotes(data.notes || "");
      setRawText(data.rawText || "");
      setSavedId(null);
      setPhase("review");
    } catch (err: any) {
      setError(err.message || "Failed to analyze file");
      setPhase("upload");
    }
  }, []);

  // Save
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/intake/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyName,
          units,
          rawText,
          claudeResponse: { confidence, notes: aiNotes },
          fileName,
          fileType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save failed");
        setSaving(false);
        return;
      }

      setSavedId(data.intakeId);
      setPhase("saved");
      loadPrevious();
    } catch (err: any) {
      setError(err.message || "Failed to save");
    }
    setSaving(false);
  }, [propertyName, units, rawText, confidence, aiNotes, fileName, fileType, loadPrevious]);

  // Reset
  const reset = useCallback(() => {
    setPhase("upload");
    setUnits([]);
    setPropertyName("");
    setFileName("");
    setFileType("");
    setRawText("");
    setConfidence("");
    setAiNotes("");
    setError("");
    setSavedId(null);
  }, []);

  // Format date
  const fmtDate = (d: string) => {
    return new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <>
      {/* Header */}
      <div className="flex justify-between items-end mb-[18px]">
        <div>
          <h1 className="text-2xl font-bold m-0 tracking-tight">Intake</h1>
          <p className="mt-1 text-cream-muted text-[13px] font-normal">
            Upload rent rolls and documents — AI extracts and structures the data
          </p>
        </div>
        {phase === "review" && (
          <div className="flex gap-2">
            <button style={btnSecondary} onClick={reset}>
              ← New Upload
            </button>
            {!savedId && (
              <button
                style={{
                  ...btnPrimary,
                  opacity: saving ? 0.5 : 1,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "💾 Save to Database"}
              </button>
            )}
          </div>
        )}
        {phase === "saved" && (
          <button
            style={{
              ...btnPrimary,
              background: "linear-gradient(135deg, #4ECDC4, #4ECDC4CC)",
              boxShadow: "0 3px 16px rgba(78,205,196,0.35)",
            }}
            onClick={reset}
          >
            + New Intake
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="glass mb-4 px-4 py-3 text-[12.5px] font-medium"
          style={{
            color: "#E07A5F",
            borderLeft: "3px solid #E07A5F",
          }}
        >
          {error}
          <button
            onClick={() => setError("")}
            className="ml-3 opacity-50 hover:opacity-100"
            style={{ background: "none", border: "none", color: "#E07A5F", cursor: "pointer", fontFamily: "inherit" }}
          >
            dismiss
          </button>
        </div>
      )}

      {/* ── UPLOAD PHASE ── */}
      {phase === "upload" && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 370px" }}>
          <IntakeUploadZone onAnalyze={handleAnalyze} />

          {/* Previous intakes */}
          <Panel title="Recent Intakes" actions={<IconBtn onClick={() => loadPrevious()}>↻</IconBtn>}>
            {loadingPrevious ? (
              <div className="text-cream-muted text-[12px] animate-pulse py-4 text-center">
                Loading...
              </div>
            ) : previousIntakes.length === 0 ? (
              <div className="text-cream-subtle text-[12px] py-6 text-center">
                No intakes yet — upload your first rent roll
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {previousIntakes.map((intake) => (
                  <div
                    key={intake.id}
                    className="glass-inner flex justify-between items-center px-3 py-2.5 cursor-pointer"
                    onClick={() => loadIntake(intake.id)}
                    style={{ transition: "all 0.15s" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "";
                    }}
                  >
                    <div>
                      <div className="text-[12px] font-medium text-cream">
                        {intake.property_name}
                      </div>
                      <div className="text-[10px] text-cream-subtle mt-0.5">
                        {intake.file_name || "—"} · {intake.unit_count} units · {fmtDate(intake.created_at)}
                      </div>
                    </div>
                    <span
                      className="px-2 py-0.5 text-[9.5px] font-semibold"
                      style={{
                        borderRadius: 4,
                        background:
                          intake.status === "reviewed"
                            ? "rgba(107,203,119,0.15)"
                            : "rgba(242,201,76,0.15)",
                        color: intake.status === "reviewed" ? "#6BCB77" : "#F2C94C",
                      }}
                    >
                      {intake.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ── PROCESSING PHASE ── */}
      {phase === "processing" && (
        <div className="glass flex flex-col items-center justify-center py-20">
          <div className="text-4xl mb-4 animate-pulse">✨</div>
          <div className="text-[14px] font-semibold text-cream mb-2">
            Analyzing {fileName || "your document"}...
          </div>
          <div className="text-[12px] text-cream-muted mb-6">
            Claude is extracting rent roll data for {propertyName}
          </div>
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full"
                style={{
                  background: "#E07A5F",
                  opacity: 0.3,
                  animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── REVIEW PHASE ── */}
      {phase === "review" && (
        <>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "1fr 370px" }}>
            <Panel
              title={`Rent Roll — ${propertyName}`}
              actions={
                <div className="flex gap-1 items-center">
                  <span className="text-[10.5px] text-cream-subtle mr-2">
                    {units.length} units extracted
                  </span>
                  <IconBtn onClick={() => {
                    const headers = ["Unit", "Tenant", "Suite", "SF", "Rate/SF", "Type", "Start", "End", "Monthly", "Annual", "Vacant"];
                    const rows = units.map((u) => [
                      u.unit_number || "", u.tenant_name || "", u.suite || "",
                      u.square_footage || "", u.lease_rate || "", u.lease_type || "",
                      u.lease_start || "", u.lease_end || "", u.monthly_rent || "",
                      u.annual_rent || "", u.is_vacant ? "Yes" : "No",
                    ]);
                    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${propertyName.replace(/\s+/g, "_")}_rent_roll.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>↓</IconBtn>
                  <IconBtn>⋯</IconBtn>
                </div>
              }
            >
              <IntakeEditableTable units={units} onChange={setUnits} />
            </Panel>

            <IntakeSummary
              units={units}
              propertyName={propertyName}
              confidence={confidence}
              notes={aiNotes}
            />
          </div>

          {/* Comps & Comparison */}
          <IntakeComparison units={units} propertyName={propertyName} />
        </>
      )}

      {/* ── SAVED PHASE ── */}
      {phase === "saved" && (
        <div className="glass flex flex-col items-center py-16">
          <div className="text-5xl mb-4">✅</div>
          <div className="text-[16px] font-bold text-cream mb-1">
            Intake Saved Successfully
          </div>
          <div className="text-[13px] text-cream-muted mb-6">
            {propertyName} — {units.length} units saved to database
          </div>
          <div className="flex gap-3">
            <button
              style={btnSecondary}
              onClick={() => {
                setSavedId(savedId);
                setPhase("review");
              }}
            >
              View Data
            </button>
            <button style={btnPrimary} onClick={reset}>
              Upload Another
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        className="flex justify-between mt-6 pt-3 text-[10px] text-cream-subtle"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <span>Stewardship Asset Group — CRE Intelligence Platform</span>
        <span>Intake · AI-Powered Rent Roll Analysis</span>
      </div>
    </>
  );
}
