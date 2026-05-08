"use client";

/**
 * DocumentsTab — simple per-property document store.
 *
 * Phase 9.5: minimum viable. Upload a file → it's stored in vault-documents
 * bucket, metadata in `documents` table, listed on the property workspace
 * forever. No category enums, no form-builder integration; just files
 * the broker needs against the asset (OMs, T-12s, signed listing
 * agreements, marketing flyers, etc.).
 *
 * Soft-delete: removed rows are marked deleted_at but storage files stay.
 * Preserves the audit trail; permanent purge is a separate admin action.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { PropertyDetail } from "@/lib/cre-os/property-queries";

interface DocumentRow {
  id: string;
  name: string;
  description: string | null;
  file_path: string;
  file_type: string | null;
  file_size_bytes: number | null;
  doc_category: string | null;
  created_at: string;
  signed_url: string | null;
}

const fmtSize = (n: number | null): string => {
  if (n === null || n === undefined) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
};

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const fileIcon = (mime: string | null, name: string): string => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const m = (mime ?? "").toLowerCase();
  if (m.includes("pdf") || ext === "pdf") return "PDF";
  if (m.includes("word") || ext === "doc" || ext === "docx") return "DOC";
  if (m.includes("sheet") || ext === "xls" || ext === "xlsx" || ext === "csv") return "XLS";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) return "IMG";
  if (m.includes("zip") || ext === "zip") return "ZIP";
  return "FILE";
};

export function DocumentsTab({ p }: { p: PropertyDetail }) {
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/properties/${p.id}/documents`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows(json.documents ?? []);
    } catch (err: any) {
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [p.id]);

  useEffect(() => { reload(); }, [reload]);

  async function uploadFile(file: File) {
    setUploadBusy(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (description.trim()) fd.append("description", description.trim());
      const res = await fetch(`/api/properties/${p.id}/documents`, { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDescription("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await reload();
    } catch (err: any) {
      setUploadError(err?.message || String(err));
    } finally {
      setUploadBusy(false);
    }
  }

  async function deleteDoc(id: string) {
    setUploadError(null);
    try {
      const res = await fetch(`/api/properties/${p.id}/documents/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setConfirmDelete(null);
      await reload();
    } catch (err: any) {
      setUploadError(err?.message || String(err));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Eyebrow tone="coral">Documents</Eyebrow>
          <h2 className="mt-1 font-heading text-base font-semibold text-cream tracking-tight">
            Files on file for this property
          </h2>
          <p className="mt-1 font-body text-[12px] text-cream-dim leading-relaxed max-w-2xl">
            Upload OMs, T-12s, listing agreements, marketing flyers — anything you want kept against the asset.
            50MB per file. Deletes are soft (file stays, hidden from view).
          </p>
        </div>
      </div>

      {/* Uploader card */}
      <div className="rounded border border-coral-400/25 bg-coral-400/[0.04] p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">
              Description (optional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this — e.g. 'OM v3 — final', 'Signed listing agreement', 'T-12 through Q1'"
              disabled={uploadBusy}
              className="mt-1 w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
            />
          </div>
          <div>
            <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Upload</label>
            <div className="mt-1">
              <input
                ref={fileInputRef}
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                }}
                disabled={uploadBusy}
                className="block w-full font-body text-[11px] text-cream-dim file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-coral-400/[0.15] file:text-coral-300 file:font-mono file:text-[10px] file:uppercase file:tracking-eyebrow file:cursor-pointer hover:file:bg-coral-400/[0.25]"
              />
            </div>
          </div>
        </div>
        {uploadBusy && (
          <p className="mt-2 font-mono text-[10px] text-coral-300">Uploading…</p>
        )}
        {uploadError && (
          <p className="mt-2 font-body text-[11px] text-red-300">{uploadError}</p>
        )}
      </div>

      {/* Document list */}
      {loading ? (
        <p className="font-body text-[12px] text-cream-subtle py-6 text-center">Loading documents…</p>
      ) : loadError ? (
        <Panel>
          <p className="font-body text-[12px] text-red-300 py-3">{loadError}</p>
        </Panel>
      ) : rows.length === 0 ? (
        <Panel>
          <div className="text-center py-6">
            <p className="font-heading text-[13px] text-cream-dim">No documents yet.</p>
            <p className="mt-1 font-body text-[11px] text-cream-subtle">
              Drop a file above to attach it to this property.
            </p>
          </div>
        </Panel>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5 rounded border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="shrink-0 w-10 h-10 rounded border border-white/[0.06] bg-steward-surface/60 flex items-center justify-center font-mono text-[9px] uppercase tracking-eyebrow text-coral-300">
                  {fileIcon(d.file_type, d.name)}
                </span>
                <div className="min-w-0 flex-1">
                  {d.signed_url ? (
                    <a
                      href={d.signed_url}
                      target="_blank"
                      rel="noreferrer"
                      className="block font-heading text-[13px] text-cream font-medium truncate hover:text-coral-300 transition-colors"
                      title={d.name}
                    >
                      {d.name}
                    </a>
                  ) : (
                    <span className="block font-heading text-[13px] text-cream-dim truncate">{d.name}</span>
                  )}
                  <div className="font-mono text-[10px] text-cream-subtle truncate">
                    {d.description ? <span className="text-cream-dim">{d.description}</span> : "—"}
                    {d.description && <span className="mx-2">·</span>}
                    {fmtSize(d.file_size_bytes)}
                    <span className="mx-2">·</span>
                    {fmtDate(d.created_at)}
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                {d.signed_url && (
                  <a
                    href={d.signed_url}
                    download={d.name}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
                  >
                    Open
                  </a>
                )}
                {confirmDelete === d.id ? (
                  <>
                    <button
                      onClick={() => deleteDoc(d.id)}
                      className="px-2.5 py-1 rounded border border-red-400/40 bg-red-500/[0.12] text-red-300 font-heading text-[10px] uppercase tracking-eyebrow font-semibold"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-2.5 py-1 rounded border border-white/[0.06] bg-white/[0.02] text-cream-dim font-heading text-[10px] uppercase tracking-eyebrow font-semibold"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(d.id)}
                    className="px-2.5 py-1 rounded border border-red-400/25 bg-red-500/[0.06] hover:bg-red-500/[0.14] text-red-300 font-heading text-[10px] uppercase tracking-eyebrow font-semibold transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
