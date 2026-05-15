/**
 * AI-personalized touch generator.
 *
 * Replaces template-string substitution in the cadence runner + the
 * Listing Leads bulk follow-up. Each call to Claude produces a uniquely
 * written subject + body for one prospect, grounded in their actual data:
 *
 *   • Property: address, asset class, sqft, year built, loan maturity,
 *     years owned, owner identity, market context
 *   • Contact: name, role, company, recent interaction (NDA signed,
 *     opened OM, viewed N times)
 *   • Lane archetype: how to frame the ask (refi math, hold-period,
 *     distress urgency, warm-lead follow-up)
 *
 * Returns conservative, no-hype copy. The model is instructed to avoid
 * sales clichés and never invent specifics. If a fact isn't in the
 * provided data, it's left out — no hallucinated cap rates, no fake
 * "I noticed you visited 47 times" claims unless we actually have that.
 */

import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";
import { createClient } from "@supabase/supabase-js";
import {
  loadPersonaBySlugWithClient,
  loadBrokerVoiceWithClient,
  renderVoiceProfile,
  renderSkillProfile,
  renderBrokerVoice,
  renderCanSpamFooter,
  type Persona,
  type BrokerVoice,
} from "@/lib/cre-os/personas-queries";
import {
  retrieveVoiceExamples,
  renderExamplesAsFewShot,
  type VoiceExample,
} from "@/lib/cre-os/voice-examples";

// ── Inputs ──────────────────────────────────────────────────────────────

export type PersonalizationChannel = "email" | "sms";

export type LaneArchetype =
  | "pre_foreclosure"
  | "refi_maturity"
  | "tired_owner"
  | "failed_listing"
  | "below_market_rent"
  | "probate"
  | "warm_lead_followup"
  // NEW — buyer-side. This person looked at OUR active listing. We're the
  // listing broker representing the seller. They're a prospective BUYER.
  // Distinct from warm_lead_followup, which historically conflated buyer-
  // and owner-side warm leads and caused mis-framed cold-acquisition copy.
  | "listing_inquiry_followup"
  | "generic";

export interface PersonalizationContext {
  channel: PersonalizationChannel;
  archetype: LaneArchetype;
  /** What step of the cadence this is (1 = first touch, 2 = second, etc.) */
  stepIndex?: number;
  /** Optional tone hint for the broker's voice */
  voice?: "warm" | "direct" | "casual";
  /** When set, narrow few-shot example retrieval to this property (and same-persona) */
  propertyId?: string | null;

  property: {
    address?: string | null;
    city?: string | null;
    state?: string | null;
    assetType?: string | null;
    sqft?: number | null;
    yearBuilt?: number | null;
    units?: number | null;
    submarket?: string | null;
    buildingClass?: string | null;
    capRate?: number | null;
    forSaleStatus?: string | null;
    /** Years since last recorded sale */
    yearsOwned?: number | null;
    /** Most recent sale price (if known) */
    lastSalePrice?: number | null;
    /** Loan maturity date if known — drives Lane B */
    mortgageMaturityDate?: string | null;
    /** Most recent lender on record */
    mortgageLender?: string | null;
    estimatedValue?: number | null;
    /** Property name (e.g. "Liberty Square Retail") */
    name?: string | null;
    /** Optional anchor intel for THIS specific property — broker-authored.
     *  Injected into the prompt when present. Lives in properties.marketing_notes. */
    marketingNotes?: string | null;
  };

  recipient: {
    /** First name preferred; full name acceptable */
    name?: string | null;
    role?: string | null;
    company?: string | null;
    /** What the recipient did to be in our outreach — affects tone */
    lastAction?: string | null;     // e.g. "Executed CA", "Viewed 7 times", "Downloaded OM"
    lastActionDate?: string | null;
    visitCount?: number | null;
  };

  /** John's signature info */
  sender: {
    name: string;
    title: string;
    phone?: string;
    email?: string;
    brand: string;
  };
}

export interface PersonalizedTouch {
  subject: string;
  body: string;
  /** What the model used to anchor the message — for audit / debugging */
  rationale?: string;
}

// ── Defaults ────────────────────────────────────────────────────────────

export const DEFAULT_SENDER = {
  name: "John Mathewson",
  title: "Broker, Stewardship CRE",
  phone: "(219) 781-9547",
  // Use the actual inbox we monitor. The Gmail OAuth send-as account is
  // inquiries@stewardshipcre.com, and the poll-gmail cron reads replies from
  // the same box. Signing with any other address creates a phantom mailbox
  // recipients might reply to, breaking the reply loop.
  email: "inquiries@stewardshipcre.com",
  brand: "Stewardship CRE",
};

// ── System prompts per archetype ────────────────────────────────────────

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

function archetypeAngle(archetype: LaneArchetype): string {
  switch (archetype) {
    case "pre_foreclosure":
      return `This owner is in pre-foreclosure (lis pendens, NOD, or NTS filed). They likely face an emotional, time-pressured situation. Lead with empathy and a no-pressure exit option. The value prop is preserving equity before forced sale.`;
    case "refi_maturity":
      return `This owner has a commercial loan maturing in the near term (typically 12-24 months). Their refi at today's higher rates may require a cash-in scenario. Lead with the math: their loan, today's rates, the cash gap. The value prop is helping them avoid writing a check at refi.`;
    case "tired_owner":
      return `This owner has held the property 15+ years, often as an absentee landlord or out-of-state. They may be tax-motivated to exit. Lead with the 1031 exchange framing or generational succession. The value prop is a tax-efficient exit while their basis is still attractive.`;
    case "failed_listing":
      return `This property was on market recently but pulled or never sold. The owner may be discouraged but still motivated. Lead by acknowledging the prior listing without judgment. The value prop is a fresh strategy or specific buyer.`;
    case "below_market_rent":
      return `This property's in-place rent is well below market. Owner may not realize the gap. Lead with the specific delta in numbers ($X in-place vs $Y market). The value prop is unlocking the value either through a lift or through a buyer who will.`;
    case "probate":
      return `This property is in probate or recently transferred via inheritance. The heirs may want to sell quickly to settle the estate. Lead with discretion and respect for the family situation. The value prop is a clean, tax-efficient sale that simplifies estate settlement.`;
    case "warm_lead_followup":
      return `This person already engaged with one of our active listings (viewed, downloaded OM, signed CA, or inquired). They've shown intent. Lead with their specific engagement and pick up the conversation. The value prop is helping them get the info or answer they need to make a decision.`;
    case "listing_inquiry_followup":
      return `CRITICAL FRAMING — read carefully:
        - The PROPERTY listed below is being SOLD by the sender (John, Stewardship CRE is the LISTING BROKER representing the seller).
        - The RECIPIENT below is a PROSPECTIVE BUYER who engaged with the listing on CREXi (signed a confidentiality agreement, downloaded the OM, requested information, or visited the listing page multiple times).
        - The recipient came to US. We did NOT cold-prospect them. DO NOT use cold-outreach language like "I came across [property]", "wanted to start a conversation", "would you be open to a 5-minute call". That framing is wrong and will burn the lead.
        - Instead: open by referencing their SPECIFIC engagement signal (e.g. "Saw you signed the CA on Liberty Square Tuesday", "Noticed you've been back to the listing a few times", "Thanks for downloading the OM on [property]").
        - The value prop is helping them get the underwriting answers or property access they need to MAKE AN OFFER. Offer one concrete next step: a walk-through tour, a Q&A call on the rent roll / cap rate / deferred maintenance, an introduction to the asset manager, or the data room.
        - DO NOT pitch them on selling their OWN property. They are the buyer side here. Confusing the direction will read as bot-generated and destroy trust.
        - Sign off as John Mathewson, the listing broker.`;
    case "generic":
    default:
      return `Generic outreach to a property owner or prospect. Keep it brief and specific to whatever property data is available.`;
  }
}

function channelInstructions(channel: PersonalizationChannel): string {
  if (channel === "sms") {
    return `Format: SMS message. MAX 320 characters total (2 segments). Plain text only. No markdown. No subject line — return empty string for "subject". The body should be ONE message that reads naturally on a phone.`;
  }
  return `Format: Email. Subject line: 6-9 words, specific to the property. Body: 3-5 short paragraphs (50-90 words total). Plain text. End with a signature using the provided sender info.`;
}

/**
 * Assemble the system + user prompts. The four voice layers cascade in
 * specificity:
 *   1. Voice instructions (always-on tone/style rules, hardcoded fallback)
 *   2. Broker voice (global — bio, brand voice, pet/banned phrases)
 *   3. Persona angle + voice profile + skill profile (per workflow type)
 *   4. Property marketing_notes (per listing — broker-authored anchor intel)
 *
 * Persona content is loaded from the `personas` table at runtime. If a row
 * isn't found (migration not run, persona removed, etc.) we fall back to
 * the hardcoded archetypeAngle() switch so the system stays functional.
 */
function buildPrompt(
  ctx: PersonalizationContext,
  persona: Persona | null,
  brokerVoice: BrokerVoice | null,
  examples: VoiceExample[]
): { system: string; userText: string } {
  const angle = persona?.angle_prompt ?? archetypeAngle(ctx.archetype);
  const personaVoice = persona ? renderVoiceProfile(persona.voice_profile) : "";
  const personaSkill = persona ? renderSkillProfile(persona.skill_profile) : "";
  const brokerVoiceBlock = renderBrokerVoice(brokerVoice);
  // CAN-SPAM footer — only emitted for email channel. Required by law.
  const canSpamBlock = ctx.channel === "email" ? renderCanSpamFooter(brokerVoice) : "";
  const fewShotBlock = renderExamplesAsFewShot(examples);
  const channelMeta = channelInstructions(ctx.channel);

  const propLines: string[] = [];
  const p = ctx.property;
  if (p.name) propLines.push(`Name: ${p.name}`);
  if (p.address) propLines.push(`Address: ${[p.address, p.city, p.state].filter(Boolean).join(", ")}`);
  if (p.assetType) propLines.push(`Asset class: ${p.assetType}`);
  if (p.sqft) propLines.push(`Size: ${p.sqft.toLocaleString()} SF`);
  if (p.units) propLines.push(`Units: ${p.units}`);
  if (p.yearBuilt) propLines.push(`Year built: ${p.yearBuilt}`);
  if (p.buildingClass) propLines.push(`Building class: ${p.buildingClass}`);
  if (p.submarket) propLines.push(`Submarket: ${p.submarket}`);
  if (p.capRate) propLines.push(`Cap rate: ${p.capRate}%`);
  if (p.forSaleStatus) propLines.push(`Listing status: ${p.forSaleStatus}`);
  if (p.yearsOwned != null) propLines.push(`Owner has held: ${p.yearsOwned} years`);
  if (p.lastSalePrice) propLines.push(`Last sale price: $${p.lastSalePrice.toLocaleString()}`);
  if (p.estimatedValue) propLines.push(`Estimated value today: $${p.estimatedValue.toLocaleString()}`);
  if (p.mortgageMaturityDate) {
    const maturity = new Date(p.mortgageMaturityDate);
    const monthsUntil = (maturity.getFullYear() - new Date().getFullYear()) * 12 +
      (maturity.getMonth() - new Date().getMonth());
    propLines.push(`Loan maturity: ${maturity.toLocaleDateString("en-US", { month: "short", year: "numeric" })} (${monthsUntil} months out)`);
  }
  if (p.mortgageLender) propLines.push(`Current lender: ${p.mortgageLender}`);

  const recipLines: string[] = [];
  const r = ctx.recipient;
  if (r.name) recipLines.push(`Name: ${r.name}`);
  if (r.role) recipLines.push(`Role: ${r.role}`);
  if (r.company) recipLines.push(`Company: ${r.company}`);
  if (r.lastAction) recipLines.push(`Most recent action: ${r.lastAction}${r.lastActionDate ? ` on ${r.lastActionDate}` : ""}`);
  if (r.visitCount && r.visitCount > 1) recipLines.push(`Has engaged with us ${r.visitCount} times`);

  // Build the system prompt by stacking layers from most-general to most-specific.
  // Skipped sections render as empty strings — graceful when DB is empty.
  const systemSections = [
    `You write outreach messages on behalf of a commercial real estate broker.`,
    VOICE_INSTRUCTIONS,
    brokerVoiceBlock && `### BROKER PROFILE (always applies)\n${brokerVoiceBlock}`,
    `### PERSONA FOR THIS MESSAGE\n${angle}`,
    personaVoice && `### PERSONA VOICE\n${personaVoice}`,
    personaSkill && `### PERSONA SKILL\n${personaSkill}`,
    // Few-shot block — real past emails to pattern on. Placed LATE in the system
    // prompt so the model sees the live voice before reading output-format rules.
    fewShotBlock,
    `### CHANNEL\n${channelMeta}`,
    // CAN-SPAM compliance — placed AFTER channel-format so the model
    // doesn't accidentally skip the footer when truncating for length.
    canSpamBlock,
    `### OUTPUT FORMAT — return ONLY a JSON object with these fields:
{
  "subject": "string (empty for SMS)",
  "body": "string — the actual message",
  "rationale": "one sentence on what fact you anchored the message on"
}

Do not include any text outside the JSON object. Do not wrap in markdown code fences.`,
  ].filter(Boolean);

  const system = systemSections.join("\n\n");

  const userText = `Write a ${ctx.channel === "sms" ? "single SMS" : "single email"} to this recipient about this property.

PROPERTY:
${propLines.length > 0 ? propLines.join("\n") : "(no property details provided)"}
${ctx.property.marketingNotes ? `\nMARKETING NOTES FOR THIS LISTING (broker-authored anchor intel — weight heavily):\n${ctx.property.marketingNotes}` : ""}

RECIPIENT:
${recipLines.length > 0 ? recipLines.join("\n") : "(unknown recipient — keep it general)"}

CADENCE STEP: ${ctx.stepIndex != null ? `Touch #${ctx.stepIndex + 1}` : "First contact"}
${ctx.stepIndex != null && ctx.stepIndex > 0 ? "(They have not yet replied to prior touches. Keep the tone respectful — no pressure escalation.)" : ""}

SENDER SIGNATURE:
${ctx.sender.name} · ${ctx.sender.title}
${ctx.sender.phone ?? ""}
${ctx.sender.email ?? ""}

Generate the message now.`;

  return { system, userText };
}

// ── Public API ──────────────────────────────────────────────────────────

export async function personalizeTouch(ctx: PersonalizationContext): Promise<PersonalizedTouch> {
  // Load the persona + broker voice + few-shot examples from DB so edits +
  // captured emails flow through immediately. All three failures are
  // independently graceful — empty corpus, missing persona, or missing
  // broker voice all degrade to the hardcoded fallback path.
  let persona: Persona | null = null;
  let brokerVoice: BrokerVoice | null = null;
  let examples: VoiceExample[] = [];
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    [persona, brokerVoice, examples] = await Promise.all([
      loadPersonaBySlugWithClient(sb, ctx.archetype),
      loadBrokerVoiceWithClient(sb),
      retrieveVoiceExamples(sb, {
        personaSlug: ctx.archetype,
        propertyId: ctx.propertyId,
        channel: ctx.channel,
        limit: 5,
      }),
    ]);
  } catch (err) {
    // Don't fail the draft if the DB lookup fails — the hardcoded fallbacks
    // keep the agent functional. Log so we notice when this happens.
    console.warn("[personalizer] persona/voice/examples load failed, using fallbacks:", err);
  }

  const { system, userText } = buildPrompt(ctx, persona, brokerVoice, examples);
  const result = await callAnthropic({
    model: MODELS.SONNET,
    system,
    messages: [{ role: "user", content: userText }],
    maxTokens: 1024,
    temperature: 0.7,
  });

  const parsed = parseJsonResponse<{ subject?: string; body?: string; rationale?: string }>(result.text);
  if (!parsed || !parsed.body) {
    // Fallback — keep the agent functional rather than failing the entire run
    return {
      subject: ctx.channel === "email" ? `About ${ctx.property.address ?? ctx.property.name ?? "your property"}` : "",
      body: result.text.trim() || "Hi — wanted to start a conversation about your property. Reply STOP to opt out.",
      rationale: "fallback — model output failed JSON parse",
    };
  }

  // Sanity-truncate SMS to 2 segments (320 chars)
  let body = parsed.body.trim();
  if (ctx.channel === "sms" && body.length > 320) {
    body = body.slice(0, 317) + "...";
  }

  return {
    subject: parsed.subject?.trim() ?? "",
    body,
    rationale: parsed.rationale,
  };
}

/**
 * Helper to derive an archetype from a lane's trigger_type or, for warm
 * leads, from the lead's interest level. Used by the bulk-followup endpoint
 * which doesn't pass an explicit lane.
 */
export function archetypeFromContext(opts: {
  laneTriggerType?: string | null;
  leadInterestLevel?: string | null;
  /** Set true when the recipient engaged with our LISTING (we're selling, they're a buyer).
   *  Routes to listing_inquiry_followup instead of the ambiguous warm_lead_followup. */
  propertyIsListing?: boolean | null;
}): LaneArchetype {
  if (opts.laneTriggerType) {
    const valid: LaneArchetype[] = [
      "pre_foreclosure", "refi_maturity", "tired_owner",
      "failed_listing", "below_market_rent", "probate",
    ];
    if (valid.includes(opts.laneTriggerType as LaneArchetype)) {
      return opts.laneTriggerType as LaneArchetype;
    }
  }
  // Listing-side warm lead: they engaged with our active listing → buyer-side ask.
  if (opts.propertyIsListing && opts.leadInterestLevel) {
    return "listing_inquiry_followup";
  }
  // Generic warm lead (no listing context — could be owner-side or buyer-side)
  if (opts.leadInterestLevel) {
    return "warm_lead_followup";
  }
  return "generic";
}
