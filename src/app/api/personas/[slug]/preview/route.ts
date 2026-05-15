/**
 * POST /api/personas/[slug]/preview
 *
 * Generate a sample AI draft using the caller-supplied edits (not the
 * saved persona row). Lets the broker iterate on voice + skill in the
 * UI and see the effect before saving.
 *
 * Picks a real lead at random from a current listing (Liberty Square or
 * Super 8) so the preview is grounded in actual data, not a mock.
 *
 * Body:
 *   {
 *     angle_prompt: string,
 *     voice_profile: { ... },
 *     skill_profile: { ... }
 *   }
 *
 * Returns:
 *   { subject, body, rationale, sample_recipient }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";
import {
  renderVoiceProfile,
  renderSkillProfile,
  renderBrokerVoice,
} from "@/lib/cre-os/personas-queries";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

const VOICE_INSTRUCTIONS = `Write in the voice of a Midwestern commercial real estate broker with 15 years of experience. Direct, honest, no fluff. Avoid:
  - Sales clichés ("I'd love to chat", "Just touching base", "Hope this finds you well")
  - Hyperbole or pressure ("amazing opportunity", "won't last", "act fast")
  - Generic openers ("My name is John and I represent...")
  - Inventing facts. If the data doesn't say something, don't claim it.
Prefer:
  - One specific observation grounded in the property data
  - A concrete value proposition (math, timing, market context)
  - A small, easy ask (5-minute call, send a number, reply yes/no)
  - Plain English`;

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  let body: {
    angle_prompt?: string;
    voice_profile?: Record<string, unknown>;
    skill_profile?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.angle_prompt) {
    return NextResponse.json({ error: "angle_prompt required" }, { status: 400 });
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load the broker voice (saved) — preview uses caller-supplied persona edits
  // BUT the global broker voice is always the saved version.
  const { data: brokerVoice } = await sb
    .from("broker_voice_profile")
    .select("*")
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  // Pick a real warm lead with an email — randomly, from active listings.
  // Falls back to a hardcoded mock if none found.
  const { data: leadCandidates } = await sb
    .from("crexi_leads_state")
    .select(`
      id, name, email, company, role, level_of_interest, number_of_visits, last_activity_date,
      property:properties(
        id, name, address, city, state, asset_type, sqft, units, year_built, cap_rate,
        building_class, submarket, for_sale_status, marketing_notes
      )
    `)
    .eq("organization_id", ORG_ID)
    .not("email", "is", null)
    .limit(20);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = (leadCandidates ?? []) as any[];
  const pick = candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : null;

  const sampleProperty = pick?.property ?? {
    name: "Liberty Square Retail",
    address: "7880-7896 Broadway",
    city: "Merrillville",
    state: "IN",
    asset_type: "Retail",
    sqft: 48327,
    cap_rate: 8.69,
    marketing_notes: null,
  };
  const sampleRecipient = pick ?? {
    name: "Sample Buyer",
    company: "Sample Capital Mgmt",
    role: "Principal Investor",
    level_of_interest: "Executed CA",
    number_of_visits: 8,
  };

  // Render the system prompt the same way the live personalizer does
  const personaVoice = renderVoiceProfile(body.voice_profile ?? {});
  const personaSkill = renderSkillProfile(body.skill_profile ?? {});
  const brokerVoiceBlock = renderBrokerVoice(brokerVoice as Parameters<typeof renderBrokerVoice>[0]);

  const propLines: string[] = [];
  if (sampleProperty.name) propLines.push(`Name: ${sampleProperty.name}`);
  if (sampleProperty.address) propLines.push(`Address: ${[sampleProperty.address, sampleProperty.city, sampleProperty.state].filter(Boolean).join(", ")}`);
  if (sampleProperty.asset_type) propLines.push(`Asset class: ${sampleProperty.asset_type}`);
  if (sampleProperty.sqft) propLines.push(`Size: ${Number(sampleProperty.sqft).toLocaleString()} SF`);
  if (sampleProperty.cap_rate) propLines.push(`Cap rate: ${sampleProperty.cap_rate}%`);

  const recipLines: string[] = [];
  if (sampleRecipient.name) recipLines.push(`Name: ${sampleRecipient.name}`);
  if (sampleRecipient.role) recipLines.push(`Role: ${sampleRecipient.role}`);
  if (sampleRecipient.company) recipLines.push(`Company: ${sampleRecipient.company}`);
  if (sampleRecipient.level_of_interest) recipLines.push(`Most recent action: ${sampleRecipient.level_of_interest}`);
  if (sampleRecipient.number_of_visits && sampleRecipient.number_of_visits > 1) {
    recipLines.push(`Has engaged with us ${sampleRecipient.number_of_visits} times`);
  }

  const systemSections = [
    `You write outreach messages on behalf of a commercial real estate broker.`,
    VOICE_INSTRUCTIONS,
    brokerVoiceBlock && `### BROKER PROFILE (always applies)\n${brokerVoiceBlock}`,
    `### PERSONA FOR THIS MESSAGE\n${body.angle_prompt}`,
    personaVoice && `### PERSONA VOICE\n${personaVoice}`,
    personaSkill && `### PERSONA SKILL\n${personaSkill}`,
    `### CHANNEL\nFormat: Email. Subject line: 6-9 words, specific to the property. Body: 3-5 short paragraphs (50-90 words total). Plain text. End with a signature.`,
    `### OUTPUT FORMAT — return ONLY a JSON object with:
{
  "subject": "string",
  "body": "string",
  "rationale": "one sentence on what fact you anchored the message on"
}

Do not include any text outside the JSON object. Do not wrap in markdown code fences.`,
  ].filter(Boolean);
  const system = systemSections.join("\n\n");

  const userText = `Write a single email to this recipient about this property.

PROPERTY:
${propLines.join("\n")}
${sampleProperty.marketing_notes ? `\nMARKETING NOTES FOR THIS LISTING (broker-authored anchor intel — weight heavily):\n${sampleProperty.marketing_notes}` : ""}

RECIPIENT:
${recipLines.join("\n")}

CADENCE STEP: First contact

SENDER SIGNATURE:
John Mathewson · Broker, Stewardship CRE
(219) 781-9547
inquiries@stewardshipcre.com

Generate the message now.`;

  try {
    const result = await callAnthropic({
      model: MODELS.SONNET,
      system,
      messages: [{ role: "user", content: userText }],
      maxTokens: 1024,
      temperature: 0.7,
    });
    const parsed = parseJsonResponse<{ subject?: string; body?: string; rationale?: string }>(result.text);
    if (!parsed?.body) {
      return NextResponse.json({ error: "Model output failed to parse" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      slug: params.slug,
      subject: parsed.subject ?? "",
      body: parsed.body,
      rationale: parsed.rationale,
      sample_recipient: {
        name: sampleRecipient.name,
        company: sampleRecipient.company,
        level_of_interest: sampleRecipient.level_of_interest,
      },
      sample_property: sampleProperty.name,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
