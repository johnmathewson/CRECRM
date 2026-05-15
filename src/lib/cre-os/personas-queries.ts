/**
 * Personas — the Prospector agent's editable voices.
 *
 * Each persona is a row in the `personas` table (see migration 0029).
 * Owns the system-prompt angle + a voice profile + a skill profile.
 *
 * Replaces the hardcoded archetypeAngle() switch that used to live in
 * src/lib/cre-os/ai-touch-personalize.ts. Editing a persona's content here
 * updates the AI's behavior on the next draft — no rebuild required.
 *
 * Architecture rule: personas are tied to WORKFLOW TYPE (slug), not to
 * specific properties or lanes. One persona handles all listings/lanes
 * using that archetype, present and future.
 */

import { createServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface VoiceProfile {
  pet_phrases?: string[];
  banned_phrases?: string[];
  tone?: string;
  structure_rules?: string[];
  sign_off?: string;
}

export interface SkillProfile {
  audience?: string;
  recipient_assumptions?: string;
  dos?: string[];
  donts?: string[];
  conversion_goal?: string;
}

export interface Persona {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  angle_prompt: string;
  voice_profile: VoiceProfile;
  skill_profile: SkillProfile;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BrokerVoice {
  id: string;
  bio: string | null;
  brand_voice: string | null;
  pet_phrases: string[];
  banned_phrases: string[];
  always_do: string[];
  never_do: string[];
  sign_off_default: string | null;
  updated_at: string;
}

/** Load all active personas for the org */
export async function loadAllPersonas(): Promise<Persona[]> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("personas")
    .select("*")
    .eq("organization_id", ORG_ID)
    .order("name");
  return (data ?? []) as Persona[];
}

/** Load one persona by slug. Returns null if not found. */
export async function loadPersonaBySlug(slug: string): Promise<Persona | null> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("personas")
    .select("*")
    .eq("organization_id", ORG_ID)
    .eq("slug", slug)
    .maybeSingle();
  return (data as Persona) ?? null;
}

/** Load the global broker voice profile. Returns null if not yet seeded. */
export async function loadBrokerVoice(): Promise<BrokerVoice | null> {
  const sb = createServerSupabase();
  const { data } = await sb
    .from("broker_voice_profile")
    .select("*")
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  return (data as BrokerVoice) ?? null;
}

/**
 * Same as loadPersonaBySlug but accepts an externally-created supabase client
 * (used by API routes that already have one and don't want to spin up the
 * server-side cookie-aware client).
 */
export async function loadPersonaBySlugWithClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: ReturnType<typeof createClient<any, any, any>>,
  slug: string
): Promise<Persona | null> {
  const { data } = await sb
    .from("personas")
    .select("*")
    .eq("organization_id", ORG_ID)
    .eq("slug", slug)
    .maybeSingle();
  return (data as Persona) ?? null;
}

export async function loadBrokerVoiceWithClient(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: ReturnType<typeof createClient<any, any, any>>
): Promise<BrokerVoice | null> {
  const { data } = await sb
    .from("broker_voice_profile")
    .select("*")
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  return (data as BrokerVoice) ?? null;
}

// ── Prompt rendering helpers ────────────────────────────────────────────

/** Render a VoiceProfile jsonb into prompt-friendly bullet text */
export function renderVoiceProfile(vp: VoiceProfile | null | undefined): string {
  if (!vp) return "";
  const lines: string[] = [];
  if (vp.tone) lines.push(`TONE: ${vp.tone}`);
  if (vp.pet_phrases && vp.pet_phrases.length > 0) {
    lines.push(`PHRASES YOU LIKE TO USE (work them in naturally when they fit, never force them): ${vp.pet_phrases.map((p) => `"${p}"`).join(", ")}`);
  }
  if (vp.banned_phrases && vp.banned_phrases.length > 0) {
    lines.push(`PHRASES TO NEVER USE: ${vp.banned_phrases.map((p) => `"${p}"`).join(", ")}`);
  }
  if (vp.structure_rules && vp.structure_rules.length > 0) {
    lines.push(`STRUCTURE RULES: ${vp.structure_rules.map((r) => `- ${r}`).join("\n  ")}`);
  }
  if (vp.sign_off) lines.push(`SIGN OFF EXACTLY: ${vp.sign_off}`);
  return lines.join("\n");
}

/** Render a SkillProfile jsonb into prompt-friendly text */
export function renderSkillProfile(sp: SkillProfile | null | undefined): string {
  if (!sp) return "";
  const lines: string[] = [];
  if (sp.audience) lines.push(`WHO YOU'RE TALKING TO: ${sp.audience}`);
  if (sp.recipient_assumptions) lines.push(`WHAT TO ASSUME ABOUT THEM: ${sp.recipient_assumptions}`);
  if (sp.dos && sp.dos.length > 0) {
    lines.push(`ALWAYS:\n  - ${sp.dos.join("\n  - ")}`);
  }
  if (sp.donts && sp.donts.length > 0) {
    lines.push(`NEVER:\n  - ${sp.donts.join("\n  - ")}`);
  }
  if (sp.conversion_goal) lines.push(`THE GOAL OF THIS MESSAGE: ${sp.conversion_goal}`);
  return lines.join("\n");
}

/** Render the global broker voice as a prompt block */
export function renderBrokerVoice(bv: BrokerVoice | null): string {
  if (!bv) return "";
  const lines: string[] = [];
  if (bv.bio) lines.push(`THE BROKER:\n${bv.bio}`);
  if (bv.brand_voice) lines.push(`BROKER'S OVERALL VOICE: ${bv.brand_voice}`);
  if (bv.pet_phrases && bv.pet_phrases.length > 0) {
    lines.push(`GLOBAL PHRASES THE BROKER USES: ${bv.pet_phrases.map((p) => `"${p}"`).join(", ")}`);
  }
  if (bv.banned_phrases && bv.banned_phrases.length > 0) {
    lines.push(`GLOBAL PHRASES THE BROKER WILL NEVER USE: ${bv.banned_phrases.map((p) => `"${p}"`).join(", ")}`);
  }
  if (bv.always_do && bv.always_do.length > 0) {
    lines.push(`BROKER ALWAYS:\n  - ${bv.always_do.join("\n  - ")}`);
  }
  if (bv.never_do && bv.never_do.length > 0) {
    lines.push(`BROKER NEVER:\n  - ${bv.never_do.join("\n  - ")}`);
  }
  if (bv.sign_off_default) lines.push(`DEFAULT SIGN-OFF: ${bv.sign_off_default}`);
  return lines.join("\n\n");
}
