"use client";

import { useState, useRef, DragEvent } from "react";
import { inputStyle, btnPrimary, btnSecondary } from "./modal";

const ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.jpg,.jpeg,.png,.webp";
const MAX_SIZE = 10 * 1024 * 1024;

const typeIcon: Record<string, string> = {
  pdf: "📄",
  docx: "📝",
  xlsx: "📊",
  xls: "📊",
  csv: "📊",
  jpg: "🖼️",
  jpeg: "🖼️",
  png: "🖼️",
  webp: "🖼️",
};

function fileExt(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface Props {
  onAnalyze: (file: File, propertyName: string) => void;
  disabled?: boolean;
}

export default function IntakeUploadZone({ onAnalyze, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [propertyName, setPropertyName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    setError("");
    if (f.size > MAX_SIZE) {
      setError("File too large — max 10 MB");
      return;
    }
    const ext = fileExt(f.name);
    if (!Object.keys(typeIcon).includes(ext)) {
      setError("Unsupported file type");
      return;
    }
    setFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function submit() {
    if (!file || !propertyName.trim()) return;
    onAnalyze(file, propertyName.trim());
  }

  const ext = file ? fileExt(file.name) : "";

  return (
    <div className="glass" style={{ padding: 28 }}>
      <h2
        className="text-[13px] font-semibold m-0 mb-5"
        style={{ color: "rgba(240,237,228,0.9)" }}
      >
        Upload Rent Roll
      </h2>

      {/* Property name */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            display: "block",
            fontSize: 10.5,
            color: "rgba(240,237,228,0.45)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 500,
            marginBottom: 5,
          }}
        >
          Property Name
        </label>
        <input
          style={inputStyle}
          placeholder="e.g. Liberty Square Shopping Center"
          value={propertyName}
          onChange={(e) => setPropertyName(e.target.value)}
          disabled={disabled}
        />
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "rgba(224,122,95,0.6)" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 6,
          padding: file ? "16px 20px" : "36px 20px",
          textAlign: "center",
          cursor: disabled ? "default" : "pointer",
          transition: "all 0.2s",
          background: dragging
            ? "rgba(224,122,95,0.04)"
            : "rgba(255,255,255,0.015)",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          disabled={disabled}
        />

        {file ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl">{typeIcon[ext] || "📎"}</span>
            <div className="text-left flex-1">
              <div className="text-[12.5px] font-medium text-cream">
                {file.name}
              </div>
              <div className="text-[11px] text-cream-subtle mt-0.5">
                {fileSize(file.size)} · {ext.toUpperCase()}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
              }}
              className="icon-btn"
              style={{ fontSize: 12 }}
              disabled={disabled}
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            <div className="text-3xl mb-2 opacity-40">📂</div>
            <div className="text-[12.5px] text-cream-muted mb-1">
              Drag & drop a file here, or{" "}
              <span style={{ color: "#E07A5F", fontWeight: 600 }}>browse</span>
            </div>
            <div className="text-[10.5px] text-cream-subtle">
              PDF, Word, Excel, CSV, or Image · Max 10 MB
            </div>
          </>
        )}
      </div>

      {error && (
        <div
          className="text-[11.5px] mt-2 font-medium"
          style={{ color: "#E07A5F" }}
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2.5 mt-5">
        <button
          style={{
            ...btnPrimary,
            opacity: !file || !propertyName.trim() || disabled ? 0.4 : 1,
            cursor:
              !file || !propertyName.trim() || disabled
                ? "not-allowed"
                : "pointer",
          }}
          onClick={submit}
          disabled={!file || !propertyName.trim() || disabled}
        >
          ✨ Analyze with AI
        </button>
        {file && (
          <button
            style={btnSecondary}
            onClick={() => {
              setFile(null);
              setPropertyName("");
              setError("");
            }}
            disabled={disabled}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
