"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { DocumentsSnapshot, PortfolioDocument } from "@/lib/cre-os/documents-queries";

const fmtSize = (n: number | null): string => {
  if (n === null || n === undefined) return "—";
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

/**
 * DocumentsView — portfolio-wide document index. The actual upload UX
 * lives on each property's Documents tab — this page is for browsing and
 * search across everything. Click any row to drill into the property
 * workspace.
 */
export function DocumentsView({ snapshot }: { snapshot: DocumentsSnapshot }) {
  const [search, setSearch] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");

  const allProperties = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const d of snapshot.documents) {
      if (!d.property) continue;
      const label = d.property.headline || d.property.name;
      map.set(d.property.id, { id: d.property.id, label });
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [snapshot.documents]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return snapshot.documents.filter((d) => {
      if (propertyFilter !== "all" && d.property?.id !== propertyFilter) return false;
      if (term) {
        const hay = [d.name, d.description, d.property?.name, d.property?.headline, d.property?.city, d.property?.state]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [snapshot.documents, search, propertyFilter]);

  const filteredSize = filtered.reduce((s, d) => s + (d.fileSizeBytes ?? 0), 0);

  // ── Right rail ─────────────────────────────────────────────────────────
  const rail: RailSection[] = [
    {
      eyebrow: "Library at a glance",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-dim">
          <RailStat label="Total documents" value={snapshot.totals.count.toString()} />
          <RailStat label="Total storage" value={fmtSize(snapshot.totals.totalSize)} />
          <RailStat label="Properties with docs" value={snapshot.totals.propertyCount.toString()} />
        </div>
      ),
    },
    {
      eyebrow: "How to use this",
      children: (
        <ul className="space-y-1.5 font-body text-[11px] text-cream-dim leading-relaxed list-disc list-inside marker:text-coral-400">
          <li>Search by file name, description, property, or city.</li>
          <li>Filter to a specific property to see just its docs.</li>
          <li>Click a file to open it in a new tab.</li>
          <li>Upload from the property's Documents tab.</li>
        </ul>
      ),
    },
    {
      eyebrow: "Quick actions",
      children: (
        <div className="space-y-1.5">
          <a
            href="/cre-os/properties"
            className="block px-3 py-2 rounded border border-coral-400/30 bg-coral-400/[0.05] hover:bg-coral-400/[0.10] font-body text-[11px] text-cream font-medium transition-colors"
          >
            Pick a property to upload to →
          </a>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-7">
        <header>
          <Eyebrow tone="coral">Documents · Library</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">Document library</h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            Every file attached to every property — OMs, T-12s, listing agreements, marketing flyers, anything else
            you've uploaded. Upload happens from the property workspace; this page is for browse and search.
          </p>
          <div className="mt-5 grid grid-cols-2 md:grid-cols-3 gap-3">
            <CommandStat label="Total documents" value={snapshot.totals.count.toString()} caption="Across the portfolio" />
            <CommandStat label="Total storage" value={fmtSize(snapshot.totals.totalSize)} caption="All files combined" />
            <CommandStat label="Properties" value={snapshot.totals.propertyCount.toString()} caption="With at least one doc" />
          </div>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Property</label>
            <select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-base lg:text-[12px] text-cream font-body outline-none focus:border-coral-400/40 transition-colors min-w-[200px]"
            >
              <option value="all" className="bg-steward-base">All properties</option>
              {allProperties.map((p) => (
                <option key={p.id} value={p.id} className="bg-steward-base">{p.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
            <label className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Search</label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="File name, description, property…"
              className="bg-white/[0.03] border border-white/[0.06] rounded-md px-3 py-2 text-base lg:text-[12px] text-cream font-body outline-none focus:border-coral-400/40 transition-colors"
            />
          </div>
          {(propertyFilter !== "all" || search.trim()) && (
            <button
              onClick={() => { setPropertyFilter("all"); setSearch(""); }}
              className="font-heading text-[10px] uppercase tracking-eyebrow text-coral-400 hover:text-coral-300 self-end pb-2"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto self-end pb-2 font-mono text-[10px] text-cream-subtle">
            {filtered.length.toLocaleString()} of {snapshot.totals.count.toLocaleString()} · {fmtSize(filteredSize)}
          </span>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <Panel>
            <div className="text-center py-8">
              {snapshot.totals.count === 0 ? (
                <>
                  <p className="font-heading text-[13px] text-cream-dim">No documents yet.</p>
                  <p className="mt-1 font-body text-[11px] text-cream-subtle">
                    Open any property and use its Documents tab to upload your first file.
                  </p>
                  <a
                    href="/cre-os/properties"
                    className="inline-block mt-4 px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.18] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 transition-colors"
                  >
                    Pick a property →
                  </a>
                </>
              ) : (
                <p className="font-body text-[11px] text-cream-subtle">No documents match the current filters.</p>
              )}
            </div>
          </Panel>
        ) : (
          <DocumentList rows={filtered} />
        )}
      </div>
    </AppShell>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function DocumentList({ rows }: { rows: PortfolioDocument[] }) {
  return (
    <div className="rounded border border-white/[0.05] bg-steward-mid/30 overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12px] font-body">
        <thead>
          <tr className="text-cream-subtle text-left bg-black/10">
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3">File</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3">Property</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Size</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right">Uploaded</th>
            <th className="font-heading text-[10px] uppercase tracking-eyebrow font-semibold py-3 px-3 text-right w-24"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="shrink-0 w-9 h-9 rounded border border-white/[0.06] bg-steward-surface/60 flex items-center justify-center font-mono text-[9px] uppercase tracking-eyebrow text-coral-300">
                    {fileIcon(d.fileType, d.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="font-heading text-cream font-medium truncate" title={d.name}>{d.name}</div>
                    {d.description && (
                      <div className="font-mono text-[10px] text-cream-subtle truncate" title={d.description}>
                        {d.description}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5 max-w-[220px]">
                {d.property?.slug ? (
                  <a
                    href={`/cre-os/properties/${d.property.slug}?tab=documents`}
                    className="block group min-w-0"
                  >
                    <span className="font-body text-cream-dim group-hover:text-coral-300 transition-colors truncate block">
                      {d.property.headline || d.property.name}
                    </span>
                    {(d.property.city || d.property.state) && (
                      <span className="font-mono text-[10px] text-cream-subtle truncate block">
                        {[d.property.city, d.property.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </a>
                ) : (
                  <span className="font-body text-cream-subtle italic">No property</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-cream-dim">{fmtSize(d.fileSizeBytes)}</td>
              <td className="px-3 py-2.5 text-right font-mono text-[10px] text-cream-subtle whitespace-nowrap">
                {fmtDate(d.createdAt)}
              </td>
              <td className="px-3 py-2.5 text-right">
                {d.property?.slug && (
                  <a
                    href={`/cre-os/properties/${d.property.slug}`}
                    className="inline-block px-2.5 py-1 rounded border border-white/[0.06] bg-white/[0.04] hover:bg-white/[0.08] font-heading text-[10px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream transition-colors"
                  >
                    Open →
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommandStat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="bg-steward-mid/40 border border-white/[0.05] rounded-md p-4">
      <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="mt-1 font-display font-medium text-2xl text-cream leading-none">{value}</div>
      {caption && <div className="mt-1 font-mono text-[9px] text-cream-subtle">{caption}</div>}
    </div>
  );
}

function RailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/[0.04] pb-1.5 last:border-b-0 last:pb-0">
      <span className="text-cream-subtle">{label}</span>
      <span className="font-mono text-cream font-semibold">{value}</span>
    </div>
  );
}
