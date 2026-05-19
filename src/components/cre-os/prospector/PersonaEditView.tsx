"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { Persona, VoiceProfile, SkillProfile } from "@/lib/cre-os/personas-queries";

export function PersonaEditView({ persona: initial }: { persona: Persona }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [anglePrompt, setAnglePrompt] = useState(initial.angle_prompt);
  const [voice, setVoice] = useState<VoiceProfile>(initial.voice_profile ?? {});
  const [skill, setSkill] = useState<SkillProfile>(initial.skill_profile ?? {});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null);

  // Preview state
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string; rationale?: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaveResult(null);
    try {
      const r = await fetch(`/api/personas/${initial.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          angle_prompt: anglePrompt,
          voice_profile: voice,
          skill_profile: skill,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setSaveResult({ ok: true });
      router.refresh();
    } catch (err) {
      setSaveResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    setPreviewBusy(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const r = await fetch(`/api/personas/${initial.slug}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Live edits — preview against the textarea values, not the saved row
          angle_prompt: anglePrompt,
          voice_profile: voice,
          skill_profile: skill,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setPreview({ subject: data.subject, body: data.body, rationale: data.rationale });
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewBusy(false);
    }
  }

  const rail: RailSection[] = [
    {
      eyebrow: "How this works",
      children: (
        <div className="space-y-2 font-body text-[11.5px] text-cream-dim leading-relaxed">
          <p>
            <strong>Angle prompt</strong> — the system-prompt block. Tells Claude what kind of conversation this is.
          </p>
          <p>
            <strong>Voice profile</strong> — pet phrases, banned phrases, structure rules, sign-off.
          </p>
          <p>
            <strong>Skill profile</strong> — audience, what to assume, do's, don'ts, conversion goal.
          </p>
          <p className="text-cream-subtle">
            Hit <strong>Preview</strong> to test against a sample warm lead before saving.
          </p>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-5">
        <header>
          <Eyebrow tone="coral">Prospector · Persona</Eyebrow>
          <Link
            href="/cre-os/prospector/personas"
            className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream"
          >
            ← All personas
          </Link>
          <h1 className="mt-1 font-display font-medium text-2xl text-cream">{name}</h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            slug: {initial.slug}
          </p>
        </header>

        <Panel eyebrow="Identity" num={1} title="Name & description">
          <div className="space-y-3">
            <Field label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Description (shown in the persona list)">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={`${inputCls} resize-y`}
              />
            </Field>
          </div>
        </Panel>

        <Panel eyebrow="Angle" num={2} title="What kind of conversation is this?">
          <p className="font-body text-[11.5px] text-cream-dim mb-2">
            This is the main system-prompt block. Explain to Claude what the situation is, who the
            recipient is, what tone is appropriate, what to do and not do.
          </p>
          <textarea
            value={anglePrompt}
            onChange={(e) => setAnglePrompt(e.target.value)}
            rows={Math.max(8, Math.min(24, anglePrompt.split("\n").length + 1))}
            className={`${inputCls} resize-y font-body leading-relaxed`}
          />
        </Panel>

        <Panel eyebrow="Voice" num={3} title="How does this persona speak?">
          <VoiceEditor value={voice} onChange={setVoice} />
        </Panel>

        <Panel eyebrow="Skill" num={4} title="What does this persona know?">
          <SkillEditor value={skill} onChange={setSkill} />
        </Panel>

        {/* Voice-learning training pass — analyzes recent edits to suggest
            persona updates */}
        <Panel eyebrow="Training" num={5} title="Learn from your edits">
          <TrainingPanel slug={initial.slug} onApplied={() => router.refresh()} />
        </Panel>

        {/* Sticky save bar */}
        <div className="sticky bottom-0 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 bg-steward-base/95 backdrop-blur-md border-t border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            {saveResult?.ok && "Saved · live now"}
            {saveResult && !saveResult.ok && (
              <span className="text-coral-300">Save failed: {saveResult.error}</span>
            )}
            {!saveResult && (
              <span>Edits are live the moment you save</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runPreview}
              disabled={previewBusy}
              className="px-3 py-1.5 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.18] disabled:opacity-40 font-mono text-[10px] uppercase tracking-eyebrow text-teal-300"
            >
              {previewBusy ? "Generating…" : "Preview"}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] disabled:opacity-40 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {previewError && (
          <Panel eyebrow="Preview error" num={5} title="Could not generate preview">
            <p className="font-mono text-[11.5px] text-coral-300">{previewError}</p>
          </Panel>
        )}

        {preview && (
          <Panel eyebrow="Preview" num={5} title="Generated draft against a sample warm lead">
            <div className="rounded border border-white/[0.08] bg-steward-base/40 p-3 space-y-2">
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-0.5">Subject</div>
                <div className="font-heading text-[13.5px] text-cream font-semibold">{preview.subject || "(no subject)"}</div>
              </div>
              <div>
                <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-0.5">Body</div>
                <pre className="font-body text-[12.5px] text-cream-dim leading-relaxed whitespace-pre-wrap">{preview.body}</pre>
              </div>
              {preview.rationale && (
                <div className="pt-2 border-t border-white/[0.05] font-mono text-[10px] text-cream-subtle italic">
                  Anchor: {preview.rationale}
                </div>
              )}
            </div>
            <p className="mt-2 font-body text-[11px] text-cream-subtle">
              This used your CURRENT edits (not the saved version). If it looks right, hit Save.
            </p>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

// ── Editors for voice + skill ────────────────────────────────────────────

function VoiceEditor({ value, onChange }: { value: VoiceProfile; onChange: (v: VoiceProfile) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Tone (one line — e.g. 'warm but direct, never apologetic')">
        <input
          type="text"
          value={value.tone ?? ""}
          onChange={(e) => onChange({ ...value, tone: e.target.value || undefined })}
          className={inputCls}
          placeholder="warm but direct, never apologetic"
        />
      </Field>
      <Field label="Phrases you like — used naturally when they fit (one per line)">
        <TagList
          tags={value.pet_phrases ?? []}
          onChange={(tags) => onChange({ ...value, pet_phrases: tags })}
          placeholder="talk soon"
        />
      </Field>
      <Field label="Phrases you never use (one per line)">
        <TagList
          tags={value.banned_phrases ?? []}
          onChange={(tags) => onChange({ ...value, banned_phrases: tags })}
          placeholder="reaching out"
        />
      </Field>
      <Field label="Structure rules (one per line)">
        <TagList
          tags={value.structure_rules ?? []}
          onChange={(tags) => onChange({ ...value, structure_rules: tags })}
          placeholder="max 3 short paragraphs"
        />
      </Field>
      <Field label="Sign-off (exact text)">
        <input
          type="text"
          value={value.sign_off ?? ""}
          onChange={(e) => onChange({ ...value, sign_off: e.target.value || undefined })}
          className={inputCls}
          placeholder="Talk soon, John"
        />
      </Field>
    </div>
  );
}

function SkillEditor({ value, onChange }: { value: SkillProfile; onChange: (v: SkillProfile) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Audience (who is this persona talking to?)">
        <textarea
          value={value.audience ?? ""}
          onChange={(e) => onChange({ ...value, audience: e.target.value || undefined })}
          rows={2}
          className={`${inputCls} resize-y`}
          placeholder="Hospitality investors and Patel-family hotel operators. CCIM-credentialed brokers."
        />
      </Field>
      <Field label="What to assume about them">
        <textarea
          value={value.recipient_assumptions ?? ""}
          onChange={(e) => onChange({ ...value, recipient_assumptions: e.target.value || undefined })}
          rows={2}
          className={`${inputCls} resize-y`}
          placeholder="They've signed the CA. Assume sophistication. Don't explain hospitality 101."
        />
      </Field>
      <Field label="Always do (one per line)">
        <TagList
          tags={value.dos ?? []}
          onChange={(tags) => onChange({ ...value, dos: tags })}
          placeholder="offer the rent roll Q&A call"
        />
      </Field>
      <Field label="Never do (one per line)">
        <TagList
          tags={value.donts ?? []}
          onChange={(tags) => onChange({ ...value, donts: tags })}
          placeholder="quote price unsolicited"
        />
      </Field>
      <Field label="Conversion goal (one sentence — what should the recipient do?)">
        <input
          type="text"
          value={value.conversion_goal ?? ""}
          onChange={(e) => onChange({ ...value, conversion_goal: e.target.value || undefined })}
          className={inputCls}
          placeholder="Get to a tour OR a Q&A call OR a written question"
        />
      </Field>
    </div>
  );
}

function TagList({ tags, onChange, placeholder }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...tags, v]);
    setDraft("");
  }
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className={inputCls}
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="shrink-0 px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] disabled:opacity-40 font-mono text-[10px] uppercase tracking-eyebrow text-cream-dim hover:text-cream"
        >
          + Add
        </button>
      </div>
      {tags.length > 0 && (
        <ul className="space-y-1">
          {tags.map((t, i) => (
            <li key={i} className="flex items-center gap-2 rounded border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5">
              <span className="flex-1 font-body text-[12px] text-cream-dim">{t}</span>
              <button
                onClick={() => onChange(tags.filter((_, j) => j !== i))}
                className="font-mono text-[10px] text-cream-subtle hover:text-coral-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";

// ── Training panel ────────────────────────────────────────────────────────
// Analyzes recent voice_examples for this persona via /learn-from-edits and
// surfaces specific voice/skill suggestions the broker can apply with one
// click. The actual learning loop — turns the broker's edits into persona
// updates without writing prose rules.

interface VoiceSuggestion {
  type: string;
  value: string;
  evidence: string;
  confidence: number;
}

function TrainingPanel({ slug, onApplied }: { slug: string; onApplied: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    suggestions: VoiceSuggestion[];
    summary: string;
    samples_analyzed: number;
    examples_total?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  async function runAnalysis() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/personas/${slug}/learn-from-edits`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setResult(data);
      setApplied(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyOne(s: VoiceSuggestion) {
    const key = `${s.type}:${s.value}`;
    try {
      const r = await fetch(`/api/personas/${slug}/apply-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: s.type, value: s.value }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setApplied((prev) => new Set(prev).add(key));
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-body text-[12px] text-cream-dim leading-relaxed">
        Reads your last 30 sent emails (manual writes + edited AI drafts) and proposes specific updates
        to this persona&rsquo;s voice + skill profile based on patterns Claude detects. Review each suggestion
        and click Apply to commit. Nothing changes until you click.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={runAnalysis}
          disabled={busy}
          className="px-3 py-1.5 rounded border border-teal-400/40 bg-teal-400/[0.10] hover:bg-teal-400/[0.18] disabled:opacity-40 font-mono text-[10px] uppercase tracking-eyebrow text-teal-300"
        >
          {busy ? "Analyzing…" : "Run training pass"}
        </button>
        {result && (
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            {result.samples_analyzed} examples analyzed
          </span>
        )}
      </div>

      {error && (
        <div className="rounded border border-coral-400/30 bg-coral-400/[0.06] px-3 py-2 font-body text-[11.5px] text-coral-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="rounded border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">Summary</div>
            <p className="font-body text-[12px] text-cream-dim leading-relaxed">{result.summary}</p>
          </div>

          {result.suggestions.length === 0 ? (
            <p className="font-body text-[11.5px] text-cream-subtle italic">
              No high-confidence patterns detected. Send a few more emails and run again.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.suggestions.map((s, i) => {
                const key = `${s.type}:${s.value}`;
                const isApplied = applied.has(key);
                return (
                  <li
                    key={i}
                    className={`rounded border px-3 py-2 ${
                      isApplied
                        ? "border-teal-400/40 bg-teal-400/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap mb-1">
                          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-coral-300">
                            {s.type.replace(/_/g, " ")}
                          </span>
                          <span className="font-heading text-[13px] text-cream font-semibold">&ldquo;{s.value}&rdquo;</span>
                          <span className="font-mono text-[9px] uppercase tracking-eyebrow text-cream-subtle">
                            conf {(s.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <p className="font-body text-[11.5px] text-cream-dim italic">{s.evidence}</p>
                      </div>
                      <button
                        onClick={() => applyOne(s)}
                        disabled={isApplied}
                        className={`shrink-0 px-3 py-1 rounded border font-mono text-[10px] uppercase tracking-eyebrow ${
                          isApplied
                            ? "border-teal-400/50 bg-teal-400/[0.10] text-teal-300 cursor-default"
                            : "border-coral-400/40 bg-coral-400/[0.10] hover:bg-coral-400/[0.20] text-coral-300"
                        }`}
                      >
                        {isApplied ? "Applied ✓" : "Apply"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
