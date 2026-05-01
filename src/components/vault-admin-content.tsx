"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const C = {
  coral: "#E07A5F",
  teal: "#4ECDC4",
  amber: "#F2C94C",
  red: "#E74C3C",
  green: "#6BCB77",
  cream: "#F0EDE4",
  charSubtle: "rgba(240,237,228,0.55)",
  charMuted: "rgba(240,237,228,0.75)",
};

interface PropertyMeta {
  id: string;
  name: string;
  headline: string | null;
  slug: string | null;
  city: string | null;
  state: string | null;
}

interface DocRow {
  id: string;
  name: string;
  file_path: string;
  file_type: string | null;
  file_size_bytes: number | null;
  doc_category: "public" | "tenant" | "buyer";
  description: string | null;
  sort_order: number;
  created_at: string;
}

const CATEGORIES: { id: "public" | "tenant" | "buyer"; label: string; description: string; color: string; bg: string }[] = [
  { id: "public", label: "Public Flyer", description: "Visible to anyone on the property page — no NDA required.", color: C.green, bg: "rgba(107,203,119,0.08)" },
  { id: "tenant", label: "Tenant Package", description: "Lease comps, availability, TI options. Tenant + buyer NDAs unlock this.", color: C.teal, bg: "rgba(78,205,196,0.08)" },
  { id: "buyer", label: "Buyer Package", description: "Rent roll, financials, due diligence. Only buyer/investor NDAs unlock this.", color: C.coral, bg: "rgba(224,122,95,0.08)" },
];

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function VaultAdminContent({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<PropertyMeta | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const [propRes, docsRes] = await Promise.all([
        supabase.from("properties").select("id, name, headline, slug, city, state").eq("id", propertyId).maybeSingle(),
        fetch(`/api/admin/documents?property_id=${propertyId}`),
      ]);
      if (!propRes.data) throw new Error("Property not found");
      setProperty(propRes.data as any);
      const docsJson = await docsRes.json();
      if (!docsRes.ok) throw new Error(docsJson.error || "Failed to load documents");
      setDocs(docsJson.documents || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="px-6 py-12 text-center text-[12px]" style={{ color: C.charSubtle }}>Loading…</div>;
  }
  if (error || !property) {
    return (
      <div className="px-6 py-12 text-center">
        <div className="text-[13px] mb-3" style={{ color: C.red }}>{error || "Property not found"}</div>
        <Link href="/properties" className="text-[12px]" style={{ color: C.teal }}>← Back to properties</Link>
      </div>
    );
  }

  const counts: Record<string, number> = { public: 0, tenant: 0, buyer: 0 };
  for (const d of docs) counts[d.doc_category] = (counts[d.doc_category] || 0) + 1;

  return (
    <div>
      <div className="mb-6">
        <Link href="/properties" className="text-[11px] tracking-wider uppercase font-medium no-underline" style={{ color: C.charSubtle }}>
          ← Properties
        </Link>
        <h1 className="text-[22px] font-semibold mt-2 mb-1" style={{ color: C.cream }}>
          Vault: {property.headline || property.name}
        </h1>
        <p className="text-[12px]" style={{ color: C.charMuted }}>
          {[property.city, property.state].filter(Boolean).join(", ")}
          {property.slug && (
            <span style={{ color: C.charSubtle }}> · slug: <code style={{ fontFamily: "monospace" }}>{property.slug}</code></span>
          )}
        </p>
        <p className="text-[11px] mt-2" style={{ color: C.charSubtle }}>
          Drop documents into the right tier. Files are private — prospects access them only via signed URLs after completing the questionnaire + NDA. Every download logs to the contact card.
        </p>
      </div>

      <div className="space-y-4">
        {CATEGORIES.map(cat => (
          <CategorySection
            key={cat.id}
            category={cat}
            propertyId={propertyId}
            docs={docs.filter(d => d.doc_category === cat.id)}
            count={counts[cat.id]}
            onChange={load}
          />
        ))}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  propertyId,
  docs,
  count,
  onChange,
}: {
  category: typeof CATEGORIES[number];
  propertyId: string;
  docs: DocRow[];
  count: number;
  onChange: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[]) {
    setUploading(true);
    setUploadError(null);
    try {
      const supabase = createClient();
      for (const file of files) {
        const ts = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
        const path = `${propertyId}/${category.id}/${ts}-${rand}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("vault-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

        const res = await fetch("/api/admin/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            property_id: propertyId,
            name: file.name,
            file_path: path,
            file_type: file.type || null,
            file_size_bytes: file.size,
            doc_category: category.id,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Metadata save failed (${res.status})`);
        }
      }
      onChange();
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function deleteDoc(id: string, name: string) {
    if (!confirm(`Remove "${name}"? Existing prospects with active consent tokens will lose access.`)) return;
    const res = await fetch(`/api/admin/documents/${id}`, { method: "DELETE" });
    if (res.ok) onChange();
  }

  return (
    <div className="glass" style={{ padding: 18, borderLeft: `3px solid ${category.color}` }}>
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <h3 className="text-[14px] font-semibold m-0" style={{ color: C.cream }}>{category.label}</h3>
        <span className="text-[10px] font-bold tracking-wider uppercase py-[2px] px-2 rounded" style={{ background: category.bg, color: category.color }}>
          {count} {count === 1 ? "doc" : "docs"}
        </span>
      </div>
      <p className="text-[11.5px] mb-3" style={{ color: C.charSubtle }}>{category.description}</p>

      {/* Drop zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const fs = Array.from(e.dataTransfer.files || []);
          if (fs.length > 0) uploadFiles(fs);
        }}
        style={{
          border: `1px dashed ${dragging ? "rgba(224,122,95,0.5)" : "rgba(255,255,255,0.1)"}`,
          background: dragging ? "rgba(224,122,95,0.05)" : "rgba(255,255,255,0.015)",
          borderRadius: 6,
          padding: "12px 14px",
          textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          fontSize: 11,
          color: C.charMuted,
          marginBottom: docs.length > 0 ? 12 : 0,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const fs = Array.from(e.target.files || []);
            if (fs.length > 0) uploadFiles(fs);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
        {uploading ? "Uploading…" : "Drag PDFs / docs here, or click to browse"}
      </div>
      {uploadError && (
        <div className="text-[11px] mb-2" style={{ color: C.red }}>{uploadError}</div>
      )}

      {/* Doc list */}
      {docs.length > 0 && (
        <div className="space-y-1">
          {docs.map(d => (
            <div
              key={d.id}
              className="flex items-center gap-3 px-3 py-2 rounded"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.04)" }}
            >
              <div className="text-[14px] flex-shrink-0">📄</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] truncate" style={{ color: C.cream }}>{d.name}</div>
                <div className="text-[10px]" style={{ color: C.charSubtle }}>
                  {formatSize(d.file_size_bytes)} · uploaded {fmtDate(d.created_at)}
                </div>
              </div>
              <button
                onClick={() => deleteDoc(d.id, d.name)}
                className="text-[10.5px] py-1 px-2 rounded"
                style={{
                  border: "1px solid rgba(231,76,60,0.3)",
                  background: "transparent",
                  color: C.red,
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
