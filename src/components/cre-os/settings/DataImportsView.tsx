"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";

type ImportSource = "costar" | "propstream";

interface ImportResult {
  totalParsed: number;
  totalInserted?: number;
  totalUpdated?: number;
  totalMatched?: number;
  totalCreated?: number;
  totalSignals?: number;
  totalSkipped: number;
  fileResults: Array<{
    fileName: string;
    parsed: number;
    inserted?: number;
    updated?: number;
    matched?: number;
    created?: number;
    signals?: number;
    skipped: number;
    errors: string[];
    headers?: string[];
    unmatchedFields?: string[];
    coverage?: Record<string, number>;
  }>;
}

interface UploadProgress {
  totalFiles: number;
  fileIndex: number;
  currentFileName: string;
  // Aggregated across all files so far
  parsed: number;
  inserted: number;
  updated: number;
  matched: number;
  created: number;
  signals: number;
  skipped: number;
  fileResults: ImportResult["fileResults"];
}

export function DataImportsView({ jobs }: { jobs: Array<Record<string, unknown>> }) {
  const router = useRouter();
  const [costarFiles, setCostarFiles] = useState<File[]>([]);
  const [propstreamFiles, setPropstreamFiles] = useState<File[]>([]);
  const [costarBusy, setCostarBusy] = useState(false);
  const [propstreamBusy, setPropstreamBusy] = useState(false);
  const [costarProgress, setCostarProgress] = useState<UploadProgress | null>(null);
  const [propstreamProgress, setPropstreamProgress] = useState<UploadProgress | null>(null);
  const [costarResult, setCostarResult] = useState<ImportResult | null>(null);
  const [propstreamResult, setPropstreamResult] = useState<ImportResult | null>(null);
  const [costarError, setCostarError] = useState<string | null>(null);
  const [propstreamError, setPropstreamError] = useState<string | null>(null);
  const [propstreamLaneTag, setPropstreamLaneTag] = useState<string>("");

  const rail: RailSection[] = [
    {
      eyebrow: "Pipeline",
      children: (
        <div className="space-y-2.5 text-[11px] font-body text-cream-dim leading-relaxed">
          <p>
            <span className="text-coral-300 font-mono mr-1.5">1.</span>
            CoStar export → cold universe (status=prospect).
          </p>
          <p>
            <span className="text-coral-300 font-mono mr-1.5">2.</span>
            PropStream export → matches by APN, stamps signal flags.
          </p>
          <p>
            <span className="text-coral-300 font-mono mr-1.5">3.</span>
            Lanes pull qualifying prospects into cadence.
          </p>
        </div>
      ),
    },
    {
      eyebrow: "Tips",
      children: (
        <div className="space-y-2 text-[11px] font-body text-cream-subtle leading-relaxed">
          <p>Use APN as the join key — it's the most reliable match between CoStar and PropStream.</p>
          <p>Re-importing the same file is safe — it updates existing rows rather than duplicating.</p>
          <p>Warm properties (in active pipeline) are never overwritten.</p>
        </div>
      ),
    },
  ];

  // Upload files one at a time so each request stays well under the
  // 60s function timeout, and so the user sees per-file progress.
  // 37 small CoStar exports (500 rows each) feels like a queue, not a wait.
  async function uploadFiles(
    source: "costar" | "propstream",
    files: File[],
    extra: Record<string, string> = {}
  ) {
    const setBusy = source === "costar" ? setCostarBusy : setPropstreamBusy;
    const setProgress = source === "costar" ? setCostarProgress : setPropstreamProgress;
    const setResult = source === "costar" ? setCostarResult : setPropstreamResult;
    const setError = source === "costar" ? setCostarError : setPropstreamError;
    const setFiles = source === "costar" ? setCostarFiles : setPropstreamFiles;
    const endpoint = source === "costar" ? "/api/imports/costar" : "/api/imports/propstream";

    setBusy(true);
    setError(null);
    setResult(null);

    const agg: UploadProgress = {
      totalFiles: files.length,
      fileIndex: 0,
      currentFileName: "",
      parsed: 0,
      inserted: 0,
      updated: 0,
      matched: 0,
      created: 0,
      signals: 0,
      skipped: 0,
      fileResults: [],
    };
    setProgress({ ...agg });

    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        agg.fileIndex = i + 1;
        agg.currentFileName = f.name;
        setProgress({ ...agg });

        // Try up to 3 times for transient gateway errors (502 / 504).
        // The function often DOES finish successfully and the response
        // just drops in transit; retrying lands the same idempotent
        // import. Real 4xx/5xx errors fail through immediately.
        const attemptUpload = async (): Promise<Response> => {
          for (let attempt = 1; attempt <= 3; attempt++) {
            const fdAttempt = new FormData();
            fdAttempt.append("files", f);
            for (const [k, v] of Object.entries(extra)) fdAttempt.append(k, v);
            const resp = await fetch(endpoint, { method: "POST", body: fdAttempt });
            if (resp.status !== 502 && resp.status !== 504) return resp;
            if (attempt === 3) return resp;
            // 1.2s, 2.4s backoff
            await new Promise((res) => setTimeout(res, attempt * 1200));
          }
          throw new Error("upload retries exhausted");
        };

        const r = await attemptUpload();
        const rawBody = await r.text();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        try {
          data = JSON.parse(rawBody);
        } catch {
          // Likely an HTML error page from Netlify/Next runtime
          const snippet = rawBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
          data = {
            error: `HTTP ${r.status}: ${snippet || "Server returned non-JSON response (likely a function timeout or memory issue)."}`,
          };
        }
        if (!r.ok) {
          setError(`${f.name}: ${data.error ?? "Upload failed"}`);
          agg.fileResults.push({
            fileName: f.name,
            parsed: 0,
            skipped: 0,
            errors: [data.error ?? "Upload failed"],
          });
          setProgress({ ...agg });
          continue;
        }

        agg.parsed += data.totalParsed ?? 0;
        agg.inserted += data.totalInserted ?? 0;
        agg.updated += data.totalUpdated ?? 0;
        agg.matched += data.totalMatched ?? 0;
        agg.created += data.totalCreated ?? 0;
        agg.signals += data.totalSignals ?? 0;
        agg.skipped += data.totalSkipped ?? 0;
        if (Array.isArray(data.fileResults)) {
          agg.fileResults.push(...data.fileResults);
        }
        setProgress({ ...agg });
      }

      // Build a single ImportResult for the result panel
      const finalResult: ImportResult = {
        totalParsed: agg.parsed,
        totalInserted: agg.inserted,
        totalUpdated: agg.updated,
        totalMatched: agg.matched,
        totalCreated: agg.created,
        totalSignals: agg.signals,
        totalSkipped: agg.skipped,
        fileResults: agg.fileResults,
      };
      setResult(finalResult);
      setFiles([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function uploadCostar() {
    if (costarFiles.length > 0) uploadFiles("costar", costarFiles);
  }

  function uploadPropstream() {
    if (propstreamFiles.length > 0) {
      uploadFiles("propstream", propstreamFiles, propstreamLaneTag ? { laneTag: propstreamLaneTag } : {});
    }
  }

  return (
    <AppShell rail={rail}>
      <div className="space-y-7 max-w-5xl">
        <header>
          <Eyebrow tone="coral">Settings · Data imports</Eyebrow>
          <h1 className="mt-1 font-display font-medium text-3xl text-cream tracking-tight">
            CoStar &amp; PropStream uploads
          </h1>
          <p className="mt-2 font-heading text-[14px] text-cream-dim leading-relaxed max-w-3xl">
            Drop your weekly exports here. CoStar is the base universe, PropStream layers signal
            flags (foreclosure, refi maturity, tax delinquency, etc.) on top. Properties in your
            warm pipeline are never modified.
          </p>
        </header>

        <Panel eyebrow="CoStar" num={1} title="Base property universe">
          <div className="space-y-4">
            <p className="text-[12px] font-body text-cream-dim leading-relaxed">
              Drop a CoStar XLSX or CSV export. Recommended columns: APN/Tax ID, Property Address,
              City, State, ZIP, County, Property Type, Building SF, Year Built, True Owner Name,
              True Owner Address/City/State/ZIP, Last Sale Date/Price, Estimated Value, Loan info.
            </p>
            <FileDrop
              files={costarFiles}
              onFiles={setCostarFiles}
              accept=".xlsx,.xls,.csv"
              label="Drop CoStar export here, or click to browse"
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[10.5px] font-mono text-cream-subtle uppercase tracking-eyebrow">
                {costarFiles.length === 0
                  ? "No file selected"
                  : `${costarFiles.length} file${costarFiles.length > 1 ? "s" : ""} ready`}
              </p>
              <button
                onClick={uploadCostar}
                disabled={costarFiles.length === 0 || costarBusy}
                className="px-4 py-2.5 lg:py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {costarBusy ? "Importing…" : "Import to Prospector"}
              </button>
            </div>
            {costarProgress && <ProgressBar p={costarProgress} source="costar" />}
            {costarError && <ErrorBanner msg={costarError} />}
            {costarResult && <ImportResultPanel result={costarResult} source="costar" />}
          </div>
        </Panel>

        <Panel eyebrow="PropStream" num={2} title="Signal flags & distress data">
          <div className="space-y-4">
            <p className="text-[12px] font-body text-cream-dim leading-relaxed">
              Drop a PropStream saved-search export. Common ones: pre-foreclosure list (Lane A),
              loan maturity in the next 24 months (Lane B), 15-year-hold absentee owners (Lane C).
              Signal flags are derived per row and stamped on the matched property.
            </p>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                Optional: Lane tag (helps audit which saved search this came from)
              </label>
              <input
                type="text"
                value={propstreamLaneTag}
                onChange={(e) => setPropstreamLaneTag(e.target.value)}
                placeholder="e.g. Lane A — Distressed — 2026-05-09"
                className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
              />
            </div>
            <FileDrop
              files={propstreamFiles}
              onFiles={setPropstreamFiles}
              accept=".xlsx,.xls,.csv"
              label="Drop PropStream export here, or click to browse"
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[10.5px] font-mono text-cream-subtle uppercase tracking-eyebrow">
                {propstreamFiles.length === 0
                  ? "No file selected"
                  : `${propstreamFiles.length} file${propstreamFiles.length > 1 ? "s" : ""} ready`}
              </p>
              <button
                onClick={uploadPropstream}
                disabled={propstreamFiles.length === 0 || propstreamBusy}
                className="px-4 py-2.5 lg:py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {propstreamBusy ? "Importing…" : "Import signals"}
              </button>
            </div>
            {propstreamProgress && <ProgressBar p={propstreamProgress} source="propstream" />}
            {propstreamError && <ErrorBanner msg={propstreamError} />}
            {propstreamResult && <ImportResultPanel result={propstreamResult} source="propstream" />}
          </div>
        </Panel>

        <Panel eyebrow="Recent imports" num={3} title="Audit log">
          {jobs.length === 0 ? (
            <p className="text-[12px] font-body text-cream-subtle italic">
              No imports yet. Your history will land here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {jobs.map((j) => (
                <ImportJobRow key={j.id as string} job={j} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function FileDrop({
  files,
  onFiles,
  accept,
  label,
}: {
  files: File[];
  onFiles: (f: File[]) => void;
  accept: string;
  label: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const list = Array.from(e.dataTransfer.files);
    if (list.length > 0) onFiles(list);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded border-2 border-dashed transition-colors px-6 py-8 text-center ${
        drag
          ? "border-coral-400/60 bg-coral-400/[0.06]"
          : "border-white/[0.10] bg-white/[0.02] hover:border-white/[0.20] hover:bg-white/[0.04]"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onFiles(Array.from(e.target.files));
        }}
      />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 mx-auto mb-2 text-cream-subtle">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="font-body text-[13px] text-cream-dim">{label}</p>
      <p className="mt-1 font-mono text-[10px] text-cream-subtle uppercase tracking-eyebrow">
        Accepts XLSX · XLS · CSV
      </p>
      {files.length > 0 && (
        <div className="mt-3 space-y-1">
          {files.map((f, i) => (
            <p key={i} className="font-mono text-[10.5px] text-coral-300">{f.name} <span className="text-cream-subtle">({(f.size / 1024).toFixed(0)}kb)</span></p>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ p, source }: { p: UploadProgress; source: ImportSource }) {
  const pct = p.totalFiles > 0 ? Math.round((p.fileIndex / p.totalFiles) * 100) : 0;
  return (
    <div className="rounded border border-coral-400/30 bg-coral-400/[0.04] px-4 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300">
            Uploading · {p.fileIndex} of {p.totalFiles}
          </div>
          <div className="font-body text-[11.5px] text-cream truncate mt-0.5">
            {p.currentFileName || "Preparing…"}
          </div>
        </div>
        <div className="font-display text-[18px] text-cream tabular-nums">{pct}%</div>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-coral-500 to-coral-300 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
        <Stat label="Parsed" value={p.parsed.toLocaleString()} />
        {source === "costar" ? (
          <>
            <Stat label="Inserted" value={p.inserted.toLocaleString()} />
            <Stat label="Updated" value={p.updated.toLocaleString()} />
          </>
        ) : (
          <>
            <Stat label="Matched" value={p.matched.toLocaleString()} />
            <Stat label="Created" value={p.created.toLocaleString()} />
          </>
        )}
        <Stat label={source === "propstream" ? "Signals" : "Skipped"} value={(source === "propstream" ? p.signals : p.skipped).toLocaleString()} />
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="rounded border border-amber/30 bg-amber/[0.08] px-3.5 py-2.5 font-body text-[12px] text-amber">
      {msg}
    </div>
  );
}

function ImportResultPanel({ result, source }: { result: ImportResult; source: ImportSource }) {
  const errors = result.fileResults.flatMap((f) => f.errors.map((e) => ({ file: f.fileName, msg: e })));

  // Aggregate coverage across files. If apn/county/owner coverage is low,
  // it likely means our column aliases don't match the file's headers —
  // surface that prominently so we can fix.
  const coverageFiles = result.fileResults.filter((f) => f.coverage);
  const avgCoverage = coverageFiles.length === 0 ? null : {
    apn: Math.round(coverageFiles.reduce((s, f) => s + (f.coverage?.apn ?? 0), 0) / coverageFiles.length),
    address: Math.round(coverageFiles.reduce((s, f) => s + (f.coverage?.address ?? 0), 0) / coverageFiles.length),
    county: Math.round(coverageFiles.reduce((s, f) => s + (f.coverage?.county ?? 0), 0) / coverageFiles.length),
    owner: Math.round(coverageFiles.reduce((s, f) => s + (f.coverage?.owner ?? 0), 0) / coverageFiles.length),
  };
  const lowCoverage = avgCoverage && (
    avgCoverage.apn < 80 || avgCoverage.county < 80 || avgCoverage.owner < 80
  );

  return (
    <div className="rounded border border-coral-400/25 bg-coral-400/[0.04] px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-coral-400" />
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300">Import complete</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
        <Stat label="Parsed" value={result.totalParsed.toLocaleString()} />
        {source === "costar" ? (
          <>
            <Stat label="Inserted" value={(result.totalInserted ?? 0).toLocaleString()} />
            <Stat label="Updated" value={(result.totalUpdated ?? 0).toLocaleString()} />
          </>
        ) : (
          <>
            <Stat label="Matched" value={(result.totalMatched ?? 0).toLocaleString()} />
            <Stat label="Created" value={(result.totalCreated ?? 0).toLocaleString()} />
          </>
        )}
        <Stat label={source === "propstream" ? "Signals" : "Skipped"} value={(source === "propstream" ? result.totalSignals ?? 0 : result.totalSkipped).toLocaleString()} />
      </div>

      {avgCoverage && (
        <div className={`mt-2 rounded border px-3 py-2 ${
          lowCoverage
            ? "border-amber/40 bg-amber/[0.06]"
            : "border-teal-400/30 bg-teal-400/[0.04]"
        }`}>
          <div className={`font-mono text-[10px] uppercase tracking-eyebrow ${lowCoverage ? "text-amber" : "text-teal-300"}`}>
            {lowCoverage ? "Low field coverage — column aliases may need updating" : "Field coverage"}
          </div>
          <div className="mt-1 grid grid-cols-4 gap-3 font-mono text-[11px]">
            <CoverageStat label="APN" pct={avgCoverage.apn} />
            <CoverageStat label="Address" pct={avgCoverage.address} />
            <CoverageStat label="County" pct={avgCoverage.county} />
            <CoverageStat label="Owner" pct={avgCoverage.owner} />
          </div>
          {lowCoverage && result.fileResults[0]?.headers && (
            <details className="mt-2">
              <summary className="font-mono text-[9.5px] text-cream-subtle cursor-pointer hover:text-cream">
                See actual file headers ▾
              </summary>
              <div className="mt-1 font-mono text-[10px] text-cream-dim leading-relaxed max-h-24 overflow-y-auto">
                {result.fileResults[0].headers.join(" · ")}
              </div>
              {result.fileResults[0].unmatchedFields && result.fileResults[0].unmatchedFields.length > 0 && (
                <div className="mt-1 font-mono text-[10px] text-amber/80">
                  Unmatched fields: {result.fileResults[0].unmatchedFields.join(", ")}
                </div>
              )}
            </details>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <details className="pt-2">
          <summary className="font-mono text-[10px] uppercase tracking-eyebrow text-amber cursor-pointer hover:text-amber/80">
            {errors.length} warning{errors.length > 1 ? "s" : ""} ▾
          </summary>
          <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {errors.slice(0, 25).map((e, i) => (
              <li key={i} className="font-mono text-[10.5px] text-amber/80">
                <span className="text-cream-subtle">{e.file}:</span> {e.msg}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CoverageStat({ label, pct }: { label: string; pct: number }) {
  const tone = pct >= 80 ? "text-teal-300" : pct >= 30 ? "text-amber" : "text-amber/70";
  return (
    <div>
      <div className="text-cream-subtle text-[9.5px]">{label}</div>
      <div className={`${tone} text-[14px] tabular-nums`}>{pct}%</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">{label}</div>
      <div className="font-display text-[18px] text-cream tabular-nums">{value}</div>
    </div>
  );
}

function ImportJobRow({ job }: { job: Record<string, unknown> }) {
  const created = job.created_at as string;
  const status = job.status as string;
  const tone =
    status === "complete" ? "text-teal-400" :
    status === "running" ? "text-amber" :
    status === "failed" ? "text-amber" :
    "text-cream-subtle";
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/[0.04] font-body text-[11.5px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300">{job.source as string}</span>
          <span className={`font-mono text-[10px] ${tone}`}>· {status}</span>
        </div>
        <div className="text-cream-dim truncate">{(job.source_detail as string) ?? "—"}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono text-[10.5px] text-cream">
          {(job.processed_records as number) ?? 0} / {(job.total_records as number) ?? 0}
        </div>
        <div className="font-mono text-[9.5px] text-cream-subtle">
          {created ? new Date(created).toLocaleString() : "—"}
        </div>
      </div>
    </div>
  );
}
