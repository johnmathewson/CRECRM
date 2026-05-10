"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";

const TRIGGERS = [
  { value: "pre_foreclosure", label: "Pre-foreclosure" },
  { value: "refi_maturity", label: "Refi maturity" },
  { value: "tired_owner", label: "Tired owner" },
  { value: "failed_listing", label: "Failed listing" },
  { value: "below_market_rent", label: "Below-market rent" },
  { value: "probate", label: "Probate / trust" },
  { value: "custom", label: "Custom" },
];

export default function NewLanePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState("custom");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/lanes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          trigger_type: triggerType,
          status: "draft",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Create failed");
      router.push(`/cre-os/prospector/lanes/${data.lane.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Create failed");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-2xl">
        <header>
          <Eyebrow tone="coral">Prospector · New lane</Eyebrow>
          <Link href="/cre-os/prospector" className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream">
            ← Back
          </Link>
          <h1 className="mt-1 font-display font-medium text-2xl text-cream">Create a new lane</h1>
        </header>

        <Panel eyebrow="Identity" num={1} title="Name your play">
          <div className="space-y-3">
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">Lane name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lane D — Failed Crexi listings"
                autoFocus
                className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle"
              />
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">Trigger archetype</label>
              <select
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value)}
                className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream"
              >
                {TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What this lane chases, what the pitch is, who you're trying to reach."
                className="w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle resize-y"
              />
            </div>
          </div>
        </Panel>

        <div className="flex items-center justify-end gap-2">
          <Link
            href="/cre-os/prospector"
            className="px-4 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-cream-dim hover:text-cream"
          >
            Cancel
          </Link>
          <button
            onClick={create}
            disabled={busy || !name.trim()}
            className="px-5 py-2 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create & configure →"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
