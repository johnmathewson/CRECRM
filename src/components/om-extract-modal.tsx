"use client";

/**
 * OM Extract Modal — upload an OM (PDF or DOCX), Claude pulls structured
 * fields, user reviews a diff (current vs OM-extracted, field-by-field) and
 * picks which to apply. Selected fields PATCHed via /api/properties/[id].
 *
 * Mounted from the property detail panel via the "Upload OM" quick-action.
 */

import { useEffect, useRef, useState } from "react";
import Modal from "./modal";
import { createClient } from "@/lib/supabase/client";

type MatchKind = "match" | "differs" | "missing-current" | "missing-extracted";

interface DiffField {
  key: string;
  currentValue: unknown;
  extractedValue: unknown;
  match: MatchKind;
  confidence: "high" | "medium" | "low" | null;
  source_quote: string | null;
}

interface ExtractResponse {
  property_id: string;
  file: { name: string; size: number; type: string };
  text_length: number;
  extracted: Record<string, unknown>;
  confidence: Record<string, "high" | "medium" | "low">;
  source_quotes: Record<string, string>;
  diff: DiffField[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  propertyName: string;
  onApplied: () => void; // parent reloads the property after we PATCH
}

const FIELD_LABELS: Record<string, string> = {
  address: "Address",
  city: "City",
  state: "State",
  zip: "Zip",
  asset_type: "Asset Type",
  asking_price: "Asking Price",
  lease_rate: "Lease Rate",
  sqft: "Square Feet",
  acreage: "Acreage",
  year_built: "Year Built",
  parking_spaces: "Parking Spaces",
  parking_ratio: "Parking Ratio",
  zoning: "Zoning",
  noi: "NOI",
  cap_rate: "Cap Rate",
  occupancy_pct: "Occupancy",
  description: "Description",
  highlights: "Highlights",
};

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    // Heuristic display: large numbers as currency, small (<=1) as percent
    if (v >= 1000) return v.toLocaleString();
    return String(v);
  }
  if (Array.isArray(v)) return v.length === 0 ? "—" : v.map(String).join(" · ");
  return String(v);
}

const C = {
  coral: "#E07A5F",
  green: "#6BCB77",
  amber: "#F2C94C",
  cream: "#F0EDE4",
};

export default function OMExtractModal({ open, onClose, propertyId, propertyName, onApplied }: Props) {
  const [stage, setStage] = useState<"upload" | "extracting" | "review" | "applying">("upload");
  const [error, setError] = useState<string | null>(null);
  const [extractResp, setExtractResp] = useState<ExtractResponse | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      setStage("upload");
      setError(null);
      setExtractResp(null);
      setAccepted(new Set());
    }
  }, [open]);

  async function handleFile(file: File) {
    setStage("extracting");
    setError(null);
    try {
      // Step 1: upload the file directly to Supabase Storage from the browser.
      // We can't POST it through Netlify because Netlify caps synchronous
      // function bodies at 6MB and OMs are typically 5–15MB; that limit
      // returns HTTP 400 with empty body before our code runs.
      const supabase = createClient();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `om-uploads/${propertyId}/${Date.now()}-${safeName}`;
      const upload = await supabase.storage
        .from("listing-documents")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upload.error) {
        setError(`Upload failed: ${upload.error.message}`);
        setStage("upload");
        return;
      }

      // Step 2: signed URL for the API route to download (1h expiry — plenty
      // for the synchronous extract flow).
      const signed = await supabase.storage
        .from("listing-documents")
        .createSignedUrl(path, 60 * 60);
      if (signed.error || !signed.data?.signedUrl) {
        setError(`Could not create signed URL: ${signed.error?.message || "(no url)"}`);
        setStage("upload");
        return;
      }

      // Step 3: ask the API to download + extract. JSON body, tiny.
      const res = await fetch(`/api/properties/${propertyId}/extract-from-om`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage_path: path,
          signed_url: signed.data.signedUrl,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
        }),
      });

      const raw = await res.text();
      let json: any = null;
      if (raw) {
        try { json = JSON.parse(raw); } catch { /* not JSON */ }
      }

      if (!res.ok) {
        const detail =
          json?.error ||
          (raw ? raw.slice(0, 200) : "(empty response — function may have timed out)");
        setError(`HTTP ${res.status}: ${detail}`);
        setStage("upload");
        return;
      }
      if (!json) {
        setError("Server returned an empty response. The OM extraction may have timed out — try a smaller PDF or trim the file.");
        setStage("upload");
        return;
      }

      setExtractResp(json as ExtractResponse);
      const auto = new Set<string>();
      (json.diff as DiffField[]).forEach((d) => {
        if (d.match === "missing-current" || d.match === "differs") auto.add(d.key);
      });
      setAccepted(auto);
      setStage("review");
    } catch (e) {
      setError((e as Error).message);
      setStage("upload");
    }
  }

  async function handleApply() {
    if (!extractResp) return;
    setStage("applying");
    try {
      const update: Record<string, unknown> = {};
      for (const d of extractResp.diff) {
        if (accepted.has(d.key)) update[d.key] = d.extractedValue;
      }
      const res = await fetch(`/api/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `HTTP ${res.status}`);
        setStage("review");
        return;
      }
      onApplied();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setStage("review");
    }
  }

  function toggle(key: string) {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`Upload OM — ${propertyName}`} width={780}>
      {stage === "upload" && (
        <div>
          <p className="text-xs text-cream-muted mb-4">
            Drop a PDF or DOCX offering memorandum. We&apos;ll extract address, sqft, NOI,
            cap rate, asking price, and other standard fields, then show you a diff so you
            can pick what to update on this property.
          </p>
          <label
            htmlFor="om-file"
            className="block w-full px-6 py-10 cursor-pointer text-center transition-all"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1.5px dashed rgba(255,255,255,0.12)",
              borderRadius: 8,
            }}
          >
            <div className="text-sm text-cream font-medium mb-1">Click to choose file</div>
            <div className="text-[11px] text-cream-subtle">PDF or DOCX, up to 25MB</div>
            <input
              ref={fileInputRef}
              id="om-file"
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
          {error && <div className="mt-3 text-xs" style={{ color: C.coral }}>{error}</div>}
        </div>
      )}

      {stage === "extracting" && (
        <div className="py-12 text-center">
          <div className="text-sm font-medium mb-1">Reading the OM…</div>
          <div className="text-[11px] text-cream-subtle">Extracting text + asking Claude to identify fields. Usually 5–15s.</div>
        </div>
      )}

      {stage === "review" && extractResp && (
        <div>
          <div className="text-[11px] text-cream-subtle mb-3">
            Pulled <strong className="text-cream">{extractResp.diff.filter((d) => d.match !== "missing-extracted" && d.match !== "match").length}</strong>{" "}
            field{(extractResp.diff.filter((d) => d.match !== "missing-extracted" && d.match !== "match").length !== 1) ? "s" : ""}{" "}
            from <strong className="text-cream">{extractResp.file.name}</strong>. Tick the rows you want to apply.
          </div>

          <div style={{ borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div className="grid items-center text-[10px] uppercase tracking-wider text-cream-subtle px-3 py-2"
              style={{ gridTemplateColumns: "26px 130px 1fr 1fr 60px", background: "rgba(255,255,255,0.03)", gap: 12 }}>
              <span></span>
              <span>Field</span>
              <span>You have</span>
              <span>OM says</span>
              <span className="text-right">Conf.</span>
            </div>
            {extractResp.diff.map((d) => {
              const isMatch = d.match === "match";
              const isMissingExtracted = d.match === "missing-extracted";
              const checked = accepted.has(d.key);
              const disabled = isMatch || isMissingExtracted;
              return (
                <div
                  key={d.key}
                  style={{
                    background: checked ? "rgba(224,122,95,0.06)" : "transparent",
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    opacity: disabled ? 0.5 : 1,
                  }}
                >
                  <label
                    htmlFor={`om-${d.key}`}
                    className="grid items-center px-3 py-2 transition-colors"
                    style={{
                      gridTemplateColumns: "26px 130px 1fr 1fr 60px",
                      gap: 12,
                      cursor: disabled ? "default" : "pointer",
                    }}
                  >
                    <input
                      id={`om-${d.key}`}
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => !disabled && toggle(d.key)}
                    />
                    <span className="text-xs font-medium text-cream">{FIELD_LABELS[d.key] ?? d.key}</span>
                    <span className="text-[11.5px] text-cream-muted truncate" title={String(d.currentValue ?? "")}>
                      {fmt(d.currentValue)}
                    </span>
                    <span
                      className="text-[11.5px] truncate"
                      style={{ color: isMissingExtracted ? "rgba(240,237,228,0.4)" : C.cream }}
                      title={String(d.extractedValue ?? "")}
                    >
                      {fmt(d.extractedValue)}
                    </span>
                    <span className="text-[10px] text-right" style={{
                      color: d.confidence === "high" ? C.green : d.confidence === "medium" ? C.amber : "rgba(240,237,228,0.4)",
                    }}>
                      {isMatch ? "match" : isMissingExtracted ? "—" : (d.confidence ?? "—")}
                    </span>
                  </label>
                  {/* Source quote — shows exactly which OM phrase produced the
                      extracted value. Lets the broker spot hallucinations
                      ("OM says $5.5M but Claude returned $7.2M? — let's see
                      where that came from"). Only shown when extracted has
                      a value AND we have a quote. */}
                  {!isMissingExtracted && !isMatch && d.source_quote && (
                    <div
                      className="px-3 pb-2 -mt-1"
                      style={{ paddingLeft: 38 + 130 + 12, fontSize: 10.5 }}
                    >
                      <span className="text-cream-subtle font-mono" style={{ letterSpacing: "0.04em" }}>
                        OM phrase:&nbsp;
                      </span>
                      <span style={{ color: "rgba(240,237,228,0.65)", fontStyle: "italic" }}>
                        &ldquo;{d.source_quote}&rdquo;
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <div className="mt-3 text-xs" style={{ color: C.coral }}>{error}</div>}

          <div className="flex justify-between items-center mt-5">
            <div className="text-[11px] text-cream-subtle">
              {accepted.size} field{accepted.size === 1 ? "" : "s"} selected
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setStage("upload");
                  setExtractResp(null);
                  setAccepted(new Set());
                }}
                className="text-xs px-4 py-2 cursor-pointer border-none"
                style={{ background: "rgba(255,255,255,0.05)", color: C.cream, borderRadius: 5 }}
              >
                Upload Different OM
              </button>
              <button
                onClick={handleApply}
                disabled={accepted.size === 0}
                className="text-xs px-4 py-2 cursor-pointer border-none font-semibold"
                style={{
                  background: accepted.size > 0 ? C.coral : "rgba(255,255,255,0.08)",
                  color: accepted.size > 0 ? "#0A1615" : "rgba(240,237,228,0.4)",
                  borderRadius: 5,
                  opacity: accepted.size > 0 ? 1 : 0.5,
                }}
              >
                Apply {accepted.size} Field{accepted.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === "applying" && (
        <div className="py-12 text-center">
          <div className="text-sm font-medium mb-1">Saving updates…</div>
        </div>
      )}
    </Modal>
  );
}
