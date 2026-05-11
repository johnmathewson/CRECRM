"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { Lane, LaneFilters, CadenceStep } from "@/lib/cre-os/prospector-queries";

const ASSET_TYPE_OPTIONS = [
  "multifamily", "retail", "office", "industrial", "mixed_use",
  "hospitality", "self_storage", "medical", "land", "special_use",
];
const OWNER_TYPE_OPTIONS = ["individual", "llc", "trust", "institutional"];

interface Facets {
  counties: string[];
  assetTypes: string[];
  signalFlags: string[];
}

interface PreviewResult {
  count: number;
  sample: Array<{
    id: string;
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    asset_type: string | null;
    sqft: number | null;
    estimated_value: number | null;
    owner_name_raw: string | null;
    prospector_signal_flags: string[] | null;
  }>;
}

export function LaneConfiguratorView({ lane, facets }: { lane: Lane; facets: Facets }) {
  const router = useRouter();
  const [name, setName] = useState(lane.name);
  const [description, setDescription] = useState(lane.description ?? "");
  const [status, setStatus] = useState(lane.status);
  const [filters, setFilters] = useState<LaneFilters>(lane.filters);
  const [cadence, setCadence] = useState<CadenceStep[]>(lane.cadence);
  const [dailyTouchCap, setDailyTouchCap] = useState(lane.dailyTouchCap);
  const [weeklyEnrollmentCap, setWeeklyEnrollmentCap] = useState(lane.weeklyEnrollmentCap);
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // Live preview when filters change (debounced)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setPreviewing(true);
      try {
        const r = await fetch(`/api/lanes/${lane.id}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters }),
        });
        const data = (await r.json()) as PreviewResult;
        if (!cancelled) setPreview(data);
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [filters, lane.id]);

  async function save() {
    setBusy(true);
    try {
      const r = await fetch(`/api/lanes/${lane.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          status,
          filters,
          cadence,
          daily_touch_cap: dailyTouchCap,
          weekly_enrollment_cap: weeklyEnrollmentCap,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Save failed");
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    if (status !== "active") {
      const ok = confirm("Lane status isn't 'active'. Enroll anyway?");
      if (!ok) return;
    }
    setEnrolling(true);
    try {
      const r = await fetch(`/api/lanes/${lane.id}/enroll`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Enrollment failed");
      alert(`Enrolled ${data.enrolled} new prospect${data.enrolled === 1 ? "" : "s"}.\n\n${data.message ?? ""}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setEnrolling(false);
    }
  }

  async function deleteLane() {
    if (!confirm("Delete this lane? Active enrollments will be removed too.")) return;
    const r = await fetch(`/api/lanes/${lane.id}`, { method: "DELETE" });
    if (r.ok) router.push("/cre-os/prospector");
    else alert("Delete failed");
  }

  const [running, setRunning] = useState(false);
  async function runCadence(dryRun: boolean) {
    setRunning(true);
    try {
      const r = await fetch("/api/cron/run-cadence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laneId: lane.id, dryRun }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Cadence run failed");
      const note = dryRun ? "DRY RUN — no touches actually sent.\n\n" : "";
      alert(`${note}Processed ${data.enrollmentsProcessed} enrollment(s)\nSent: ${data.touchesSent}\nQueued: ${data.touchesQueued}\nSkipped: ${data.touchesSkipped}\nExited: ${data.enrollmentsExited}${data.errors?.length ? "\nErrors:\n" + data.errors.slice(0, 5).join("\n") : ""}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cadence run failed");
    } finally {
      setRunning(false);
    }
  }

  const rail: RailSection[] = [
    {
      eyebrow: "Live preview",
      children: (
        <div className="space-y-3 font-body text-[11.5px] text-cream-dim">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Currently matching</div>
            <div className="mt-1 font-display text-3xl text-cream tabular-nums">
              {previewing ? "…" : preview?.count.toLocaleString() ?? "—"}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">Currently enrolled</div>
            <div className="mt-1 font-display text-2xl text-cream tabular-nums">{lane.liveEnrolled}</div>
          </div>
          <div className="pt-1 border-t border-white/[0.04] space-y-1.5">
            <button
              onClick={enroll}
              disabled={enrolling || (preview?.count ?? 0) === 0}
              className="w-full px-3 py-2.5 lg:py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40"
            >
              {enrolling ? "Enrolling…" : `Enroll up to ${weeklyEnrollmentCap}`}
            </button>
            <button
              onClick={() => runCadence(false)}
              disabled={running || lane.liveEnrolled === 0}
              className="w-full px-3 py-2.5 lg:py-2 rounded border border-white/[0.10] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream disabled:opacity-40"
            >
              {running ? "Running…" : "Run cadence now"}
            </button>
            <button
              onClick={() => runCadence(true)}
              disabled={running || lane.liveEnrolled === 0}
              className="w-full px-3 py-1.5 rounded border border-white/[0.06] hover:bg-white/[0.03] font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream disabled:opacity-40"
            >
              Dry-run (no sends)
            </button>
          </div>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow tone="coral">Prospector · Lane configurator</Eyebrow>
            <Link href="/cre-os/prospector" className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream">
              ← Back to Prospector
            </Link>
            <h1 className="mt-1 font-display font-medium text-2xl text-cream">{name}</h1>
          </div>
          <div className="flex items-center gap-2">
            {savedFlash && <span className="font-mono text-[10px] uppercase tracking-eyebrow text-teal-400">Saved</span>}
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save lane"}
            </button>
            <button
              onClick={deleteLane}
              className="px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-amber/10 hover:border-amber/30 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-subtle hover:text-amber"
            >
              Delete
            </button>
          </div>
        </header>

        <Panel eyebrow="Identity" num={1} title="Name & status">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Lane["status"])}
                className={inputCls}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Description" className="md:col-span-2">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={`${inputCls} resize-y`}
              />
            </Field>
          </div>
        </Panel>

        <Panel eyebrow="Universe" num={2} title="Who qualifies">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Asset types">
              <ChipSet
                options={ASSET_TYPE_OPTIONS}
                selected={filters.asset_types ?? []}
                onChange={(v) => setFilters({ ...filters, asset_types: v })}
              />
            </Field>
            <Field label="Counties">
              <ChipSet
                options={facets.counties.length > 0 ? facets.counties : ["Lake", "Porter", "Cook", "Jasper", "Newton", "LaPorte"]}
                selected={filters.counties ?? []}
                onChange={(v) => setFilters({ ...filters, counties: v })}
              />
            </Field>
            <Field label="States">
              <ChipSet
                options={["IN", "IL"]}
                selected={filters.states ?? []}
                onChange={(v) => setFilters({ ...filters, states: v })}
              />
            </Field>
            <Field label="Owner types">
              <ChipSet
                options={OWNER_TYPE_OPTIONS}
                selected={filters.owner_types ?? []}
                onChange={(v) => setFilters({ ...filters, owner_types: v })}
              />
            </Field>
            <Field label="Square footage">
              <RangeInputs
                min={filters.sqft_min ?? null}
                max={filters.sqft_max ?? null}
                onChange={(min, max) => setFilters({ ...filters, sqft_min: min, sqft_max: max })}
              />
            </Field>
            <Field label="Est. value ($)">
              <RangeInputs
                min={filters.value_min ?? null}
                max={filters.value_max ?? null}
                onChange={(min, max) => setFilters({ ...filters, value_min: min, value_max: max })}
              />
            </Field>
            <Field label="Units (multifamily)">
              <RangeInputs
                min={filters.units_min ?? null}
                max={filters.units_max ?? null}
                onChange={(min, max) => setFilters({ ...filters, units_min: min, units_max: max })}
              />
            </Field>
            <Field label="Year built">
              <RangeInputs
                min={filters.year_built_min ?? null}
                max={filters.year_built_max ?? null}
                onChange={(min, max) => setFilters({ ...filters, year_built_min: min, year_built_max: max })}
              />
            </Field>
            <Field label="Min years owned">
              <input
                type="number"
                value={filters.min_years_owned ?? ""}
                onChange={(e) => setFilters({ ...filters, min_years_owned: e.target.value ? parseInt(e.target.value) : null })}
                className={inputCls}
              />
            </Field>
            <Field label={`Trigger window (months ${lane.triggerType === "refi_maturity" ? "until maturity" : ""})`}>
              <input
                type="number"
                value={filters.trigger_window_months ?? ""}
                onChange={(e) => setFilters({ ...filters, trigger_window_months: e.target.value ? parseInt(e.target.value) : null })}
                className={inputCls}
              />
            </Field>
          </div>
        </Panel>

        <Panel eyebrow="Trigger signals" num={3} title="Required signal flags">
          <p className="text-[12px] font-body text-cream-dim mb-3">
            Properties must have ALL the selected flags to qualify. Leave empty to ignore signal flags
            (the lane will be filter-driven only).
          </p>
          {facets.signalFlags.length > 0 ? (
            <ChipSet
              options={facets.signalFlags}
              selected={filters.required_signal_flags ?? []}
              onChange={(v) => setFilters({ ...filters, required_signal_flags: v })}
            />
          ) : (
            <p className="font-body text-[11.5px] text-cream-subtle italic">
              No signal flags in your data yet. Drop a PropStream export and they'll appear here.
            </p>
          )}
        </Panel>

        <Panel eyebrow="Cadence" num={4} title="Sequence of touches">
          <div className="space-y-2">
            {cadence.map((step, i) => (
              <CadenceRow
                key={i}
                step={step}
                onChange={(s) => setCadence(cadence.map((c, j) => (j === i ? s : c)))}
                onDelete={() => setCadence(cadence.filter((_, j) => j !== i))}
              />
            ))}
            <button
              onClick={() =>
                setCadence([...cadence, { day_offset: 7, channel: "email", subject: "", body: "" }])
              }
              className="w-full px-3 py-2.5 lg:py-2 rounded border border-dashed border-white/[0.10] hover:border-coral-400/40 hover:text-coral-300 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-subtle transition-colors"
            >
              + Add step
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Governors" num={5} title="Volume & approval">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Daily touch cap">
              <input
                type="number"
                value={dailyTouchCap}
                onChange={(e) => setDailyTouchCap(parseInt(e.target.value) || 0)}
                className={inputCls}
              />
            </Field>
            <Field label="Weekly enrollment cap">
              <input
                type="number"
                value={weeklyEnrollmentCap}
                onChange={(e) => setWeeklyEnrollmentCap(parseInt(e.target.value) || 0)}
                className={inputCls}
              />
            </Field>
          </div>
        </Panel>

        {/* Preview sample */}
        <Panel eyebrow="Preview" num={6} title={`Top ${preview?.sample.length ?? 0} matching properties`}>
          {preview && preview.sample.length > 0 ? (
            <div className="space-y-1.5">
              {preview.sample.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-white/[0.02] border border-white/[0.04] font-body text-[11.5px]">
                  <div className="min-w-0">
                    <div className="text-cream truncate font-semibold">{p.name ?? p.address ?? "(unnamed)"}</div>
                    <div className="text-cream-subtle truncate">
                      {[p.address, p.city, p.state].filter(Boolean).join(", ")}
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono text-[10.5px]">
                    <div className="text-cream">{p.asset_type ?? "—"}</div>
                    <div className="text-cream-subtle">
                      {p.sqft ? `${p.sqft.toLocaleString()} sf` : ""}
                      {p.estimated_value ? ` · $${(p.estimated_value / 1_000_000).toFixed(1)}M` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-body text-[12px] text-cream-subtle italic">
              No properties match these filters yet. Try widening the universe or import more data.
            </p>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function ChipSet({ options, selected, onChange }: {
  options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(on ? selected.filter((s) => s !== opt) : [...selected, opt])}
            className={`px-2.5 py-1 rounded border font-mono text-[10.5px] uppercase tracking-eyebrow transition-colors ${
              on
                ? "border-coral-400/50 bg-coral-400/[0.12] text-coral-300"
                : "border-white/[0.08] bg-white/[0.02] text-cream-dim hover:bg-white/[0.05]"
            }`}
          >
            {opt.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}

function RangeInputs({ min, max, onChange }: {
  min: number | null; max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={min ?? ""}
        onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null, max)}
        placeholder="min"
        className={inputCls}
      />
      <span className="text-cream-subtle text-[11px]">—</span>
      <input
        type="number"
        value={max ?? ""}
        onChange={(e) => onChange(min, e.target.value ? parseFloat(e.target.value) : null)}
        placeholder="max"
        className={inputCls}
      />
    </div>
  );
}

function CadenceRow({ step, onChange, onDelete }: {
  step: CadenceStep;
  onChange: (s: CadenceStep) => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-start px-3 py-2 rounded bg-white/[0.02] border border-white/[0.04]">
      <div className="col-span-2">
        <label className="block font-mono text-[8.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">Day</label>
        <input
          type="number"
          value={step.day_offset}
          onChange={(e) => onChange({ ...step, day_offset: parseInt(e.target.value) || 0 })}
          className={inputCls}
        />
      </div>
      <div className="col-span-2">
        <label className="block font-mono text-[8.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">Channel</label>
        <select
          value={step.channel}
          onChange={(e) => onChange({ ...step, channel: e.target.value as CadenceStep["channel"] })}
          className={inputCls}
        >
          <option value="letter">Letter</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="call">Call</option>
          <option value="voicemail">Voicemail</option>
        </select>
      </div>
      <div className="col-span-7">
        <label className="block font-mono text-[8.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">Subject / Notes</label>
        <input
          type="text"
          value={step.subject ?? step.notes ?? ""}
          onChange={(e) => onChange({ ...step, subject: e.target.value })}
          className={inputCls}
        />
      </div>
      <div className="col-span-1 flex justify-end">
        <button
          onClick={onDelete}
          className="mt-5 p-1.5 text-cream-subtle hover:text-amber transition-colors"
          aria-label="Delete step"
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}
