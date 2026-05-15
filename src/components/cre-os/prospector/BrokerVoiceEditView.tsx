"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { BrokerVoice } from "@/lib/cre-os/personas-queries";

export function BrokerVoiceEditView({ voice: initial }: { voice: BrokerVoice | null }) {
  const router = useRouter();
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [brandVoice, setBrandVoice] = useState(initial?.brand_voice ?? "");
  const [petPhrases, setPetPhrases] = useState<string[]>(initial?.pet_phrases ?? []);
  const [bannedPhrases, setBannedPhrases] = useState<string[]>(initial?.banned_phrases ?? []);
  const [alwaysDo, setAlwaysDo] = useState<string[]>(initial?.always_do ?? []);
  const [neverDo, setNeverDo] = useState<string[]>(initial?.never_do ?? []);
  const [signOff, setSignOff] = useState(initial?.sign_off_default ?? "");
  // CAN-SPAM compliance fields
  const [physicalAddress, setPhysicalAddress] = useState(initial?.physical_address ?? "");
  const [unsubscribeEmail, setUnsubscribeEmail] = useState(initial?.unsubscribe_email ?? "inquiries@stewardshipcre.com");
  const [dailySendCap, setDailySendCap] = useState(initial?.daily_send_cap ?? 100);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null);

  async function save() {
    setSaving(true);
    setSaveResult(null);
    try {
      const r = await fetch(`/api/broker-voice`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio: bio || null,
          brand_voice: brandVoice || null,
          pet_phrases: petPhrases,
          banned_phrases: bannedPhrases,
          always_do: alwaysDo,
          never_do: neverDo,
          sign_off_default: signOff || null,
          physical_address: physicalAddress || null,
          unsubscribe_email: unsubscribeEmail || null,
          daily_send_cap: dailySendCap,
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

  const rail: RailSection[] = [
    {
      eyebrow: "Why this exists",
      children: (
        <div className="space-y-2 font-body text-[11.5px] text-cream-dim leading-relaxed">
          <p>
            This is the broker&rsquo;s <strong>global voice</strong> — applied to every AI draft, regardless of persona.
          </p>
          <p>
            Persona-level rules layer on top of this. Per-property notes layer on top of those. This is the
            base coat — your bio, your brand, your always-on banned phrases.
          </p>
          <p className="text-cream-subtle">
            Saves are live the moment you commit them — every next AI draft reads from here.
          </p>
        </div>
      ),
    },
    {
      eyebrow: "Quick links",
      children: (
        <div className="space-y-1.5">
          <Link
            href="/cre-os/prospector/personas"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream"
          >
            Personas →
          </Link>
          <Link
            href="/cre-os/prospector"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream"
          >
            ← Back to Prospector
          </Link>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-5">
        <header>
          <Eyebrow tone="coral">Prospector · Broker voice</Eyebrow>
          <Link
            href="/cre-os/prospector"
            className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream"
          >
            ← Back to Prospector
          </Link>
          <h1 className="mt-1 font-display font-medium text-2xl text-cream">Your global voice</h1>
          <p className="mt-2 font-heading text-[13px] text-cream-dim leading-relaxed max-w-3xl">
            Applied to every AI draft in the CRM. Persona-level rules can override these for specific
            conversation types, but this is the base layer that always applies.
          </p>
        </header>

        <Panel eyebrow="Bio" num={1} title="Who you are">
          <p className="font-body text-[11.5px] text-cream-dim mb-2">
            One paragraph. The agent uses this to ground its understanding of the broker for any conversation.
            Example: <em>John is a 20-year CRE broker in Northwest Indiana. Active owner-operator himself,
            so he reads pro formas like an investor, not a listing agent. Direct, numbers-forward, no fluff.</em>
          </p>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            className={`${inputCls} resize-y leading-relaxed`}
            placeholder="John is a 20-year CRE broker in Northwest Indiana..."
          />
        </Panel>

        <Panel eyebrow="Brand voice" num={2} title="One-line summary of how you sound">
          <input
            type="text"
            value={brandVoice}
            onChange={(e) => setBrandVoice(e.target.value)}
            className={inputCls}
            placeholder="Direct, Midwestern, numbers-forward. No clichés."
          />
        </Panel>

        <Panel eyebrow="Phrases" num={3} title="What you do / don't say">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                Phrases you use (work in naturally)
              </label>
              <TagList tags={petPhrases} onChange={setPetPhrases} placeholder="talk soon" />
            </div>
            <div>
              <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                Phrases you NEVER use
              </label>
              <TagList tags={bannedPhrases} onChange={setBannedPhrases} placeholder="reaching out" />
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Always / never" num={4} title="Behavioral rules">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                Always do
              </label>
              <TagList tags={alwaysDo} onChange={setAlwaysDo} placeholder="open with their specific engagement signal" />
            </div>
            <div>
              <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                Never do
              </label>
              <TagList tags={neverDo} onChange={setNeverDo} placeholder="quote prices unsolicited" />
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Sign-off" num={5} title="Default closing line">
          <input
            type="text"
            value={signOff}
            onChange={(e) => setSignOff(e.target.value)}
            className={inputCls}
            placeholder="— John"
          />
        </Panel>

        {/* Compliance — required by CAN-SPAM. The AI uses these to render
            the footer on every outbound email. Also defensive: the bulk
            send paths enforce daily_send_cap to protect domain reputation. */}
        <Panel eyebrow="Compliance" num={6} title="CAN-SPAM + send-rate safety">
          <div className="space-y-3">
            <div>
              <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                Physical mailing address (required by law)
              </label>
              <textarea
                value={physicalAddress}
                onChange={(e) => setPhysicalAddress(e.target.value)}
                rows={3}
                className={`${inputCls} resize-y`}
                placeholder="Stewardship CRE&#10;123 Main St, Suite 200&#10;Crown Point, IN 46307"
              />
              <p className="mt-1 font-body text-[11px] text-cream-subtle leading-relaxed">
                Appended to every outbound email footer. CAN-SPAM compliance: every commercial email
                must include the sender&rsquo;s physical postal address.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                  Unsubscribe email
                </label>
                <input
                  type="email"
                  value={unsubscribeEmail}
                  onChange={(e) => setUnsubscribeEmail(e.target.value)}
                  className={inputCls}
                  placeholder="inquiries@stewardshipcre.com"
                />
                <p className="mt-1 font-body text-[11px] text-cream-subtle">
                  Where opt-out replies should be sent. Auto-detect on inbound is on the roadmap; manual processing for now.
                </p>
              </div>
              <div>
                <label className="block font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle mb-1">
                  Daily send cap (org-wide)
                </label>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={dailySendCap}
                  onChange={(e) => setDailySendCap(Math.max(1, parseInt(e.target.value || "100")))}
                  className={inputCls}
                />
                <p className="mt-1 font-body text-[11px] text-cream-subtle">
                  Hard ceiling on outbound emails per calendar day. Protects domain reputation from
                  a bad blast. Bulk send paths refuse to exceed this.
                </p>
              </div>
            </div>
          </div>
        </Panel>

        <div className="sticky bottom-0 -mx-4 lg:-mx-6 px-4 lg:px-6 py-3 bg-steward-base/95 backdrop-blur-md border-t border-white/[0.08] flex items-center justify-between gap-3 flex-wrap">
          <div className="font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle">
            {saveResult?.ok && <span className="text-teal-300">Saved · live on next draft</span>}
            {saveResult && !saveResult.ok && (
              <span className="text-coral-300">Save failed: {saveResult.error}</span>
            )}
            {!saveResult && "Edits are live the moment you save"}
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-1.5 rounded border border-coral-400/40 bg-coral-400/[0.12] hover:bg-coral-400/[0.20] disabled:opacity-40 font-heading text-[11px] uppercase tracking-eyebrow font-semibold text-coral-300"
          >
            {saving ? "Saving…" : "Save voice"}
          </button>
        </div>
      </div>
    </AppShell>
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

const inputCls =
  "w-full px-3 py-2 rounded bg-steward-surface/60 border border-white/[0.06] focus:border-coral-400/40 focus:outline-none font-body text-base lg:text-[12px] text-cream placeholder:text-cream-subtle";
