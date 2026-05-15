"use client";

import Link from "next/link";
import { AppShell } from "@/components/cre-os/AppShell";
import { Eyebrow } from "@/components/cre-os/Eyebrow";
import { Panel } from "@/components/cre-os/Panel";
import type { RailSection } from "@/components/cre-os/InsightsRail";
import type { Persona } from "@/lib/cre-os/personas-queries";

export function PersonasListView({ personas }: { personas: Persona[] }) {
  const rail: RailSection[] = [
    {
      eyebrow: "What's a persona?",
      children: (
        <div className="space-y-2 font-body text-[11.5px] text-cream-dim leading-relaxed">
          <p>
            A persona is the agent's <strong>way of speaking</strong> for a specific kind of conversation.
          </p>
          <p>
            One persona handles <strong>all listings, all leads, all current and future lanes</strong> that use it.
            Edit a persona once → every AI draft using it improves instantly.
          </p>
          <p className="text-cream-subtle">
            Personas are tied to <em>workflow type</em>, not to specific properties.
          </p>
        </div>
      ),
    },
    {
      eyebrow: "Quick links",
      children: (
        <div className="space-y-1.5">
          <Link
            href="/cre-os/prospector"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream"
          >
            ← Back to Prospector
          </Link>
          <Link
            href="/cre-os/prospector/inbox"
            className="block px-3 py-2 rounded border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] font-body text-[11px] text-cream-dim hover:text-cream"
          >
            Inbox →
          </Link>
        </div>
      ),
    },
  ];

  return (
    <AppShell rail={rail}>
      <div className="space-y-5">
        <header>
          <Eyebrow tone="coral">Prospector · Personas</Eyebrow>
          <Link
            href="/cre-os/prospector"
            className="mt-1 inline-block font-mono text-[10px] uppercase tracking-eyebrow text-cream-subtle hover:text-cream"
          >
            ← Back to Prospector
          </Link>
          <h1 className="mt-1 font-display font-medium text-2xl text-cream">
            The agent's voices
          </h1>
          <p className="mt-2 font-heading text-[13px] text-cream-dim leading-relaxed max-w-3xl">
            Each persona is a distinct voice + skill profile for one kind of conversation. Editing
            a persona instantly updates every AI draft using it — no code change, no deploy.
          </p>
        </header>

        <Panel
          eyebrow="Personas"
          num={1}
          title={`${personas.length} active`}
        >
          {personas.length === 0 ? (
            <p className="font-body text-[12px] text-cream-subtle italic py-6 text-center">
              No personas seeded yet. Run migration 0029.
            </p>
          ) : (
            <div className="space-y-1.5">
              {personas.map((p) => (
                <PersonaCard key={p.slug} persona={p} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function PersonaCard({ persona }: { persona: Persona }) {
  const voiceCount =
    (persona.voice_profile?.pet_phrases?.length ?? 0) +
    (persona.voice_profile?.banned_phrases?.length ?? 0) +
    (persona.voice_profile?.structure_rules?.length ?? 0);
  const skillCount =
    (persona.skill_profile?.dos?.length ?? 0) +
    (persona.skill_profile?.donts?.length ?? 0);

  return (
    <Link
      href={`/cre-os/prospector/personas/${persona.slug}`}
      className="block rounded border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] hover:border-coral-400/30 transition-colors px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-0.5">
            <div className="font-heading text-[14px] text-cream font-semibold">
              {persona.name}
            </div>
            <span className="font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
              {persona.slug}
            </span>
          </div>
          {persona.description && (
            <p className="font-body text-[11.5px] text-cream-dim leading-relaxed mb-1.5">
              {persona.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 font-mono text-[9.5px] uppercase tracking-eyebrow text-cream-subtle">
            <span className="px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.02]">
              {persona.angle_prompt.length} chars · angle
            </span>
            <span className={`px-1.5 py-0.5 rounded border ${voiceCount > 0 ? "border-teal-400/30 text-teal-300" : "border-white/[0.06]"}`}>
              {voiceCount} voice rules
            </span>
            <span className={`px-1.5 py-0.5 rounded border ${skillCount > 0 ? "border-teal-400/30 text-teal-300" : "border-white/[0.06]"}`}>
              {skillCount} skill rules
            </span>
            {!persona.is_active && (
              <span className="px-1.5 py-0.5 rounded border border-amber/30 text-amber bg-amber/[0.06]">
                inactive
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 font-mono text-[10px] text-cream-subtle">
          edit →
        </div>
      </div>
    </Link>
  );
}
