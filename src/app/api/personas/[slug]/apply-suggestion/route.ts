/**
 * POST /api/personas/[slug]/apply-suggestion
 *
 * Applies a single voice-learning suggestion to the persona's voice_profile
 * or skill_profile. The learn-from-edits endpoint generates suggestions;
 * the UI renders them with apply/dismiss buttons; this endpoint executes
 * the apply.
 *
 * Body:
 *   { type: SuggestionType, value: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

type Suggestion = { type: string; value: string };

function uniqueAdd<T>(arr: T[] | undefined, item: T): T[] {
  const existing = arr ?? [];
  if (existing.includes(item)) return existing;
  return [...existing, item];
}

function removeItem<T>(arr: T[] | undefined, item: T): T[] {
  return (arr ?? []).filter((x) => x !== item);
}

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let body: Suggestion;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.type || !body.value) {
    return NextResponse.json({ error: "type and value required" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: persona } = await sb
    .from("personas")
    .select("id, voice_profile, skill_profile")
    .eq("organization_id", ORG_ID)
    .eq("slug", params.slug)
    .maybeSingle();
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  const voice = (persona.voice_profile as Record<string, unknown>) ?? {};
  const skill = (persona.skill_profile as Record<string, unknown>) ?? {};

  switch (body.type) {
    case "add_pet_phrase":
      voice.pet_phrases = uniqueAdd(voice.pet_phrases as string[], body.value);
      break;
    case "remove_pet_phrase":
      voice.pet_phrases = removeItem(voice.pet_phrases as string[], body.value);
      break;
    case "add_banned_phrase":
      voice.banned_phrases = uniqueAdd(voice.banned_phrases as string[], body.value);
      break;
    case "remove_banned_phrase":
      voice.banned_phrases = removeItem(voice.banned_phrases as string[], body.value);
      break;
    case "add_structure_rule":
      voice.structure_rules = uniqueAdd(voice.structure_rules as string[], body.value);
      break;
    case "remove_structure_rule":
      voice.structure_rules = removeItem(voice.structure_rules as string[], body.value);
      break;
    case "update_sign_off":
      voice.sign_off = body.value;
      break;
    case "update_tone":
      voice.tone = body.value;
      break;
    case "add_skill_do":
      skill.dos = uniqueAdd(skill.dos as string[], body.value);
      break;
    case "remove_skill_do":
      skill.dos = removeItem(skill.dos as string[], body.value);
      break;
    case "add_skill_dont":
      skill.donts = uniqueAdd(skill.donts as string[], body.value);
      break;
    case "remove_skill_dont":
      skill.donts = removeItem(skill.donts as string[], body.value);
      break;
    case "update_audience":
      skill.audience = body.value;
      break;
    default:
      return NextResponse.json({ error: `Unknown suggestion type: ${body.type}` }, { status: 400 });
  }

  const { error } = await sb
    .from("personas")
    .update({
      voice_profile: voice,
      skill_profile: skill,
      updated_at: new Date().toISOString(),
    })
    .eq("id", persona.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, voice_profile: voice, skill_profile: skill });
}
