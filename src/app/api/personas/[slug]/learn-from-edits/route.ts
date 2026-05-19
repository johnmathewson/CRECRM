/**
 * POST /api/personas/[slug]/learn-from-edits
 *
 * The voice-learning loop. Pulls the last N voice_examples for this persona,
 * sends them to Claude with the persona's current voice/skill profile, and
 * asks: "What patterns do you see in how the broker actually writes vs what
 * the AI is producing? Suggest specific updates."
 *
 * Returns structured suggestions the broker can apply with one click:
 *   {
 *     suggestions: [
 *       { type: "add_banned_phrase", value: "reach out", evidence: "...", confidence: 0.85 },
 *       { type: "add_pet_phrase", value: "talk soon", evidence: "...", confidence: 0.92 },
 *       { type: "add_skill_do", value: "always cite a specific number", ... },
 *       ...
 *     ],
 *     summary: "Of the last 12 emails you sent, you removed 'reach out' 7 times and added 'talk soon' to 5 closings. Suggest tightening the persona accordingly.",
 *     samples_analyzed: 12
 *   }
 *
 * Does NOT auto-apply. The persona editor shows the suggestions and the
 * broker reviews + clicks Apply per item.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export type SuggestionType =
  | "add_pet_phrase"
  | "remove_pet_phrase"
  | "add_banned_phrase"
  | "remove_banned_phrase"
  | "add_structure_rule"
  | "remove_structure_rule"
  | "update_sign_off"
  | "add_skill_do"
  | "remove_skill_do"
  | "add_skill_dont"
  | "remove_skill_dont"
  | "update_tone"
  | "update_audience";

export interface VoiceSuggestion {
  type: SuggestionType;
  /** The phrase / rule / value being added or removed */
  value: string;
  /** One-sentence justification grounded in actual examples */
  evidence: string;
  /** 0-1 — how confident Claude is this is a real pattern, not noise */
  confidence: number;
}

const SYSTEM = `You are a writing-style analyst helping calibrate an AI email-drafting persona to match a commercial real estate broker's actual voice.

The broker has been sending emails using one of our personas. Some emails were sent as-is from the AI's draft (good — the persona worked). Others were edited before sending (signal — the persona's voice was off in some way). And some were written from scratch manually (the broker's pure voice when not relying on AI).

Your job is to read a sample of recent sent emails, the current persona configuration, and propose SPECIFIC updates to the persona's voice_profile and skill_profile that would make future AI drafts closer to what the broker actually sends.

Focus on:
  - Phrases the broker consistently ADDS to drafts → suggest add_pet_phrase
  - Phrases the broker consistently REMOVES or REPLACES → suggest add_banned_phrase
  - Structural patterns (e.g. always sign with "Talk soon, John") → suggest update_sign_off or add_structure_rule
  - Tone / register patterns → suggest update_tone
  - Things the broker always does → suggest add_skill_do
  - Things the broker never does that the AI keeps doing → suggest add_skill_dont

RULES:
1. EVIDENCE-BASED ONLY. For each suggestion, cite the specific examples that support it (e.g. "Removed 'reach out' from 4 of 6 AI drafts; never used it in manual writes."). No speculation.
2. NEEDS PATTERN STRENGTH. If a phrase appears once or twice, don't suggest changing the persona — could be noise. Require at least 2-3 consistent occurrences.
3. CONFIDENCE CALIBRATION. 0.9+ = strong pattern across many examples. 0.6-0.9 = noticeable pattern. Below 0.6 = don't propose.
4. AVOID DUPLICATES. Don't suggest a phrase that's already in the relevant list (e.g. don't add "talk soon" to pet_phrases if it's already there).
5. PRIORITIZE HIGH-LEVERAGE. Better to surface 3 strong suggestions than 15 marginal ones.

OUTPUT FORMAT — return ONLY a JSON object:
{
  "suggestions": [
    {
      "type": "one of the SuggestionType values",
      "value": "the phrase / rule / value",
      "evidence": "one sentence citing specific examples",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "2-3 sentence narrative summary of what you observed",
  "samples_analyzed": <number>
}

Valid type values: add_pet_phrase, remove_pet_phrase, add_banned_phrase, remove_banned_phrase, add_structure_rule, remove_structure_rule, update_sign_off, add_skill_do, remove_skill_do, add_skill_dont, remove_skill_dont, update_tone, update_audience

Do not include any text outside the JSON object. No markdown code fences.`;

export async function POST(_req: NextRequest, { params }: { params: { slug: string } }) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load the persona — required so Claude knows the current config
  const { data: persona } = await sb
    .from("personas")
    .select("id, slug, name, angle_prompt, voice_profile, skill_profile")
    .eq("organization_id", ORG_ID)
    .eq("slug", params.slug)
    .maybeSingle();
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  // Pull the recent voice examples for this persona. Prefer:
  //   - ai_edited (richest signal — have AI draft + sent + diff)
  //   - manual    (broker's authentic voice when writing from scratch)
  //   - ai_drafted (what the AI produced that the broker accepted as-is)
  const { data: examples } = await sb
    .from("voice_examples")
    .select("source, subject, body, user_edits_diff, sent_at")
    .eq("organization_id", ORG_ID)
    .eq("persona_id", persona.id)
    .eq("is_blocked", false)
    .order("sent_at", { ascending: false })
    .limit(30);

  // Also pull manual examples that aren't linked to a persona but were
  // sent through Compose (broker's authentic voice). Useful as a baseline.
  const { data: manualExamples } = await sb
    .from("voice_examples")
    .select("source, subject, body, user_edits_diff, sent_at")
    .eq("organization_id", ORG_ID)
    .is("persona_id", null)
    .eq("source", "manual")
    .eq("is_blocked", false)
    .order("sent_at", { ascending: false })
    .limit(15);

  const allExamples = [...(examples ?? []), ...(manualExamples ?? [])];
  if (allExamples.length < 3) {
    return NextResponse.json({
      ok: true,
      suggestions: [],
      summary: `Only ${allExamples.length} example email${allExamples.length === 1 ? "" : "s"} captured so far — need at least 3-5 to detect patterns. Send a few more emails through Compose first, then come back.`,
      samples_analyzed: allExamples.length,
    });
  }

  // Render the persona + examples into a Claude-readable prompt
  const personaSummary = `CURRENT PERSONA: ${persona.name} (${persona.slug})

CURRENT VOICE PROFILE:
${JSON.stringify(persona.voice_profile ?? {}, null, 2)}

CURRENT SKILL PROFILE:
${JSON.stringify(persona.skill_profile ?? {}, null, 2)}`;

  const exampleBlocks = allExamples.map((ex, i) => {
    const lines: string[] = [];
    lines.push(`--- EXAMPLE ${i + 1} (${ex.source}, sent ${ex.sent_at}) ---`);
    if (ex.source === "ai_edited" && ex.user_edits_diff) {
      lines.push(`The AI drafted something, the broker edited it before sending. Full diff:`);
      lines.push(ex.user_edits_diff);
    } else {
      lines.push(`SUBJECT: ${ex.subject ?? "(none)"}`);
      lines.push(`BODY:\n${ex.body}`);
    }
    return lines.join("\n");
  }).join("\n\n");

  const userText = `Analyze these emails and suggest specific updates to the persona to make future AI drafts closer to the broker's actual voice.

${personaSummary}

SAMPLE OF RECENT SENT EMAILS (${allExamples.length} examples):
${exampleBlocks}

Return JSON only with your structured suggestions.`;

  try {
    const result = await callAnthropic({
      model: MODELS.SONNET,
      system: SYSTEM,
      messages: [{ role: "user", content: userText }],
      maxTokens: 2048,
      temperature: 0.3,
    });

    const parsed = parseJsonResponse<{
      suggestions?: VoiceSuggestion[];
      summary?: string;
      samples_analyzed?: number;
    }>(result.text);

    if (!parsed) {
      return NextResponse.json({ error: "Claude response failed to parse" }, { status: 502 });
    }

    // Sanity-filter low-confidence suggestions
    const filtered = (parsed.suggestions ?? []).filter((s) => {
      const conf = Number(s.confidence);
      return Number.isFinite(conf) && conf >= 0.6;
    });

    return NextResponse.json({
      ok: true,
      suggestions: filtered,
      summary: parsed.summary ?? "(no summary)",
      samples_analyzed: parsed.samples_analyzed ?? allExamples.length,
      examples_total: allExamples.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
