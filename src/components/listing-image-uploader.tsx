"use client";
import { useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ListingImage {
  url: string;
  alt?: string;
  order: number;
}

interface Props {
  value: ListingImage[];
  onChange: (images: ListingImage[]) => void;
}

const coral = "#E07A5F";
const cream = "#F0EDE4";
const creamMuted = "rgba(240,237,228,0.55)";
const creamSubtle = "rgba(240,237,228,0.35)";

const BUCKET = "listing-images";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function sanitizeFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : "jpg";
  const cleanStem = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "image";
  return `${cleanStem}.${ext.toLowerCase()}`;
}

export default function ListingImageUploader({ value, onChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError("");
      setUploading(true);

      const newImages: ListingImage[] = [...value];
      let nextOrder = newImages.length > 0 ? Math.max(...newImages.map(i => i.order)) + 1 : 0;

      try {
        for (const file of files) {
          if (file.size > MAX_FILE_BYTES) {
            setError(`${file.name} is over 10 MB — skipped.`);
            continue;
          }
          if (!ALLOWED_TYPES.includes(file.type)) {
            setError(`${file.name} is not a supported image type — skipped.`);
            continue;
          }

          const ts = Date.now();
          const rand = Math.random().toString(36).slice(2, 8);
          const path = `${ts}-${rand}-${sanitizeFilename(file.name)}`;

          const { error: uploadErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, file, { cacheControl: "31536000", upsert: false });

          if (uploadErr) {
            console.error("Upload error:", uploadErr);
            setError(`Upload failed for ${file.name}: ${uploadErr.message}`);
            continue;
          }

          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
          newImages.push({
            url: urlData.publicUrl,
            alt: "",
            order: nextOrder,
          });
          nextOrder += 1;
        }

        onChange(newImages);
      } catch (e: any) {
        setError(e.message || "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [value, onChange, supabase]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) uploadFiles(files);
  }

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) uploadFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeImage(idx: number) {
    const updated = value
      .filter((_, i) => i !== idx)
      .map((img, i) => ({ ...img, order: i }));
    onChange(updated);
  }

  function moveImage(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= value.length) return;
    const updated = [...value];
    [updated[idx], updated[target]] = [updated[target], updated[idx]];
    onChange(updated.map((img, i) => ({ ...img, order: i })));
  }

  function updateAlt(idx: number, alt: string) {
    const updated = value.map((img, i) => (i === idx ? { ...img, alt } : img));
    onChange(updated);
  }

  return (
    <div>
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "rgba(224,122,95,0.6)" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 8,
          padding: "24px 20px",
          textAlign: "center",
          cursor: "pointer",
          transition: "all 0.2s",
          background: dragging ? "rgba(224,122,95,0.05)" : "rgba(255,255,255,0.015)",
          marginBottom: 12,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          style={{ display: "none" }}
          onChange={handleSelect}
        />
        <div style={{ fontSize: 28, marginBottom: 6, opacity: 0.4 }}>🖼️</div>
        <div style={{ fontSize: 12.5, color: creamMuted, marginBottom: 3 }}>
          {uploading ? (
            <>Uploading…</>
          ) : (
            <>
              Drag & drop images, or{" "}
              <span style={{ color: coral, fontWeight: 600 }}>browse</span>
            </>
          )}
        </div>
        <div style={{ fontSize: 11, color: creamSubtle }}>
          JPG, PNG, WebP, or GIF · up to 10 MB each · multiple files OK
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: coral, marginBottom: 10, fontWeight: 500 }}>
          {error}
        </div>
      )}

      {/* Thumbnail grid */}
      {value.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {value.map((img, idx) => (
            <div
              key={img.url}
              style={{
                position: "relative",
                borderRadius: 6,
                overflow: "hidden",
                border: "1px solid rgba(255,255,255,0.07)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div style={{ position: "relative", paddingBottom: "66%", background: "rgba(0,0,0,0.4)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.alt || `Image ${idx + 1}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
                {idx === 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 6, left: 6,
                      fontSize: 9.5, fontWeight: 700,
                      padding: "2px 6px", borderRadius: 3,
                      background: coral, color: "white",
                    }}
                  >
                    PRIMARY
                  </span>
                )}
                {/* Prominent remove button — top right of thumbnail */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Remove this photo${idx === 0 ? " (the primary)" : ""}?`)) {
                      removeImage(idx);
                    }
                  }}
                  title="Remove this photo"
                  aria-label="Remove this photo"
                  style={{
                    position: "absolute",
                    top: 6, right: 6,
                    width: 28, height: 28,
                    borderRadius: "50%",
                    background: "rgba(231,76,60,0.9)",
                    color: "white",
                    border: "1px solid rgba(255,255,255,0.2)",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 700,
                    lineHeight: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ padding: "6px 8px", display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  value={img.alt || ""}
                  onChange={e => updateAlt(idx, e.target.value)}
                  placeholder="Alt text…"
                  style={{
                    flex: 1, fontSize: 10.5, padding: "3px 6px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 3, color: cream, outline: "none",
                  }}
                />
                <button
                  onClick={() => moveImage(idx, -1)}
                  disabled={idx === 0}
                  title="Move up"
                  style={{
                    border: "none", background: "transparent",
                    color: idx === 0 ? creamSubtle : cream,
                    cursor: idx === 0 ? "default" : "pointer",
                    padding: 2, fontSize: 11,
                  }}
                >↑</button>
                <button
                  onClick={() => moveImage(idx, 1)}
                  disabled={idx === value.length - 1}
                  title="Move down"
                  style={{
                    border: "none", background: "transparent",
                    color: idx === value.length - 1 ? creamSubtle : cream,
                    cursor: idx === value.length - 1 ? "default" : "pointer",
                    padding: 2, fontSize: 11,
                  }}
                >↓</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {value.length > 0 && (
        <div style={{ fontSize: 10.5, color: creamSubtle, marginTop: 8 }}>
          First image is the primary — used as the main hero on the public listing page.
        </div>
      )}
    </div>
  );
}
