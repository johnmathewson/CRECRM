"use client";

import { ChangeEvent, useMemo, useState } from "react";
import Modal, { FormField, inputStyle, selectStyle, btnPrimary, btnSecondary } from "./modal";
import {
  AnalysisMode,
  SubjectSnapshot,
  parseCompText,
  parseRentRoll,
  runCompAnalysis,
} from "@/lib/comp-analysis";

interface PropertyLike {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  asset_type?: string | null;
  asking_price?: number | null;
  lease_rate?: number | null;
  sqft?: number | null;
  year_built?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  property: PropertyLike | null;
}

const sectionCard: React.CSSProperties = {
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 6,
  padding: 14,
};

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 10, color: "rgba(240,237,228,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#F0EDE4" }}>{value}</div>
    </div>
  );
}

export default function CompAnalysisModal({ open, onClose, property }: Props) {
  const [mode, setMode] = useState<AnalysisMode>("mixed");
  const [occupancyPercent, setOccupancyPercent] = useState("");
  const [rentRollText, setRentRollText] = useState("");
  const [compText, setCompText] = useState("");

  const subject: SubjectSnapshot | null = property
    ? {
        propertyName: property.name,
        address: property.address,
        city: property.city,
        state: property.state,
        assetType: property.asset_type,
        sqft: property.sqft,
        yearBuilt: property.year_built,
        askingPrice: property.asking_price,
        leaseRate: property.lease_rate,
        occupancyPercent: occupancyPercent ? Number(occupancyPercent) : null,
        extractedRentRollText: rentRollText,
      }
    : null;

  const rentRollPreview = useMemo(() => parseRentRoll(rentRollText), [rentRollText]);
  const compPreview = useMemo(() => parseCompText(compText), [compText]);

  const analysis = useMemo(() => {
    if (!subject || !compText.trim()) return { result: null, error: null as string | null };
    try {
      return { result: runCompAnalysis(subject, compText, mode), error: null as string | null };
    } catch (err) {
      return {
        result: null,
        error: err instanceof Error ? err.message : "Could not run comp analysis.",
      };
    }
  }, [subject, compText, mode]);

  const { result, error } = analysis;

  const handleFileUpload =
    (target: "rentRoll" | "comps") =>
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      if (target === "rentRoll") setRentRollText(text);
      if (target === "comps") setCompText(text);
    };

  const fmtMoney = (value?: number | null) =>
    value == null ? "—" : `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  if (!property) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Comp Analysis — ${property.name}`} width={1080}>
      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={sectionCard}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>1. Subject Property</div>
            <div style={{ display: "grid", gap: 10 }}>
              <StatPill label="Asset Type" value={(property.asset_type || "Unknown").replace(/_/g, " ")} />
              <StatPill label="Location" value={[property.city, property.state].filter(Boolean).join(", ") || "—"} />
              <StatPill label="Size" value={property.sqft ? `${property.sqft.toLocaleString()} SF` : "—"} />
              <StatPill label="Asking Price" value={fmtMoney(property.asking_price)} />
              <StatPill label="Lease Rate" value={property.lease_rate != null ? `${property.lease_rate.toFixed(2)} / SF` : "—"} />
            </div>
          </div>

          <div style={sectionCard}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>2. Analysis Settings</div>
            <FormField label="Mode">
              <select style={selectStyle} value={mode} onChange={(e) => setMode(e.target.value as AnalysisMode)}>
                <option value="mixed">Lease + Sale</option>
                <option value="lease">Lease comps only</option>
                <option value="sale">Sale comps only</option>
              </select>
            </FormField>
            <FormField label="Occupancy %">
              <input
                style={inputStyle}
                type="number"
                step="0.1"
                value={occupancyPercent}
                onChange={(e) => setOccupancyPercent(e.target.value)}
                placeholder="85"
              />
            </FormField>
          </div>

          <div style={sectionCard}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>3. Subject Rent Roll</div>
            <FormField label="Upload Rent Roll CSV / TSV">
              <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload("rentRoll")} />
            </FormField>
            <FormField label="Or Paste Extracted Rent Roll">
              <textarea
                style={{ ...inputStyle, minHeight: 180, resize: "vertical" }}
                value={rentRollText}
                onChange={(e) => setRentRollText(e.target.value)}
                placeholder={"unit,tenant,sqft,annual rent,rent psf,status\n101,Starbucks,2500,60000,24,occupied"}
              />
            </FormField>
            <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)" }}>
              Parsed rows: {rentRollPreview.length}
            </div>
          </div>

          <div style={sectionCard}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>4. Comparable Set</div>
            <FormField label="Upload Comp CSV / TSV">
              <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload("comps")} />
            </FormField>
            <FormField label="Or Paste Comparable Data">
              <textarea
                style={{ ...inputStyle, minHeight: 220, resize: "vertical" }}
                value={compText}
                onChange={(e) => setCompText(e.target.value)}
                placeholder={"name,comp type,property type,city,sqft,distance,lease rate,price psf,cap rate\nLiberty Plaza,lease,retail,Valparaiso,11000,1.2,22.5,,\nMain Street Shops,sale,retail,Valparaiso,13250,2.1,,245,0.071"}
              />
            </FormField>
            <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)" }}>
              Parsed comps: {compPreview.length}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={sectionCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Analysis Output</div>
              <button type="button" style={btnSecondary} onClick={onClose}>
                Close
              </button>
            </div>

            {error && (
              <div style={{ color: "#E07A5F", fontSize: 12, marginBottom: 10 }}>{error}</div>
            )}

            {!result && !error && (
              <div style={{ fontSize: 12, color: "rgba(240,237,228,0.55)", lineHeight: 1.7 }}>
                Add comp data to run the stack. This workflow now anchors the analysis to the selected property,
                compares the subject to sale and lease comps, adjusts the comp values, and explains where the subject
                appears above, below, or inside market range.
              </div>
            )}

            {result && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  <StatPill
                    label="Weighted In-Place Rent"
                    value={result.subject.weightedRentPsf != null ? `${result.subject.weightedRentPsf.toFixed(2)} / SF` : "—"}
                  />
                  <StatPill label="Occupied SF" value={result.subject.occupiedSqft ? result.subject.occupiedSqft.toLocaleString() : "—"} />
                  <StatPill label="Annualized Rent" value={fmtMoney(result.subject.annualizedRent)} />
                  <StatPill label="Parsed Comps" value={String(result.rankedComps.length)} />
                </div>

                <div style={sectionCard}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Indicated Ranges</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    <StatPill
                      label="Rent PSF"
                      value={
                        result.ranges.rentPsf
                          ? `${result.ranges.rentPsf.low.toFixed(2)} - ${result.ranges.rentPsf.high.toFixed(2)}`
                          : "—"
                      }
                    />
                    <StatPill
                      label="Price PSF"
                      value={
                        result.ranges.pricePsf
                          ? `${result.ranges.pricePsf.low.toFixed(2)} - ${result.ranges.pricePsf.high.toFixed(2)}`
                          : "—"
                      }
                    />
                    <StatPill
                      label="Cap Rate"
                      value={
                        result.ranges.capRate
                          ? `${(result.ranges.capRate.low * 100).toFixed(2)}% - ${(result.ranges.capRate.high * 100).toFixed(2)}%`
                          : "—"
                      }
                    />
                  </div>
                </div>

                <div style={sectionCard}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Reconciliation Narrative</div>
                  <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(240,237,228,0.8)" }}>{result.narrative}</div>
                </div>

                <div style={sectionCard}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>Ranked Comp Stack</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflow: "auto" }}>
                    {result.rankedComps.map((comp) => (
                      <div
                        key={comp.id}
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.06)",
                          borderRadius: 6,
                          padding: 12,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{comp.name}</div>
                            <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)", marginTop: 3 }}>
                              {(comp.compType || "—").toUpperCase()} · {(comp.propertyType || "Unknown").replace(/_/g, " ")} · {comp.city || "Unknown city"}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)" }}>Relevance</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#E07A5F" }}>{(comp.relevanceScore * 100).toFixed(0)}%</div>
                          </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10 }}>
                          <StatPill label="Distance" value={comp.distanceMiles != null ? `${comp.distanceMiles.toFixed(1)} mi` : "—"} />
                          <StatPill label="Size" value={comp.sqft ? `${comp.sqft.toLocaleString()} SF` : "—"} />
                          <StatPill label="Adj. Rent" value={comp.adjustedLeaseRate != null ? `${comp.adjustedLeaseRate.toFixed(2)} / SF` : "—"} />
                          <StatPill label="Adj. Price" value={comp.adjustedPricePsf != null ? `${comp.adjustedPricePsf.toFixed(2)} / SF` : "—"} />
                        </div>

                        <div style={{ marginTop: 10, fontSize: 11.5, color: "rgba(240,237,228,0.6)", lineHeight: 1.6 }}>
                          Adjustments:
                          {" "}
                          size {(comp.adjustments.sizeAdjustmentPct * 100).toFixed(2)}%,
                          {" "}
                          age {(comp.adjustments.ageAdjustmentPct * 100).toFixed(2)}%,
                          {" "}
                          distance {(comp.adjustments.distanceAdjustmentPct * 100).toFixed(2)}%,
                          {" "}
                          occupancy {(comp.adjustments.occupancyAdjustmentPct * 100).toFixed(2)}%
                        </div>

                        {comp.reasoning.length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {comp.reasoning.map((reason) => (
                              <span
                                key={reason}
                                style={{
                                  fontSize: 10.5,
                                  padding: "4px 8px",
                                  borderRadius: 999,
                                  background: "rgba(224,122,95,0.14)",
                                  border: "1px solid rgba(224,122,95,0.18)",
                                  color: "#E07A5F",
                                }}
                              >
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "rgba(240,237,228,0.45)" }}>
              This analysis is now deterministic and transparent instead of only prompt-driven.
            </div>
            <button type="button" style={{ ...btnPrimary, opacity: result ? 1 : 0.45 }} disabled={!result}>
              Use in report review
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
