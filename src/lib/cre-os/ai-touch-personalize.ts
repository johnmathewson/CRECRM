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
  | "generic";

export interface PersonalizationContext {
  channel: PersonalizationChannel;
  archetype: LaneArchetype;
  /** What step of the cadence this is (1 = first touch, 2 = second, etc.) */
  stepIndex?: number;
  /** Optional tone hint for the broker's voice */
  voice?: "warm" | "direct" | "casual";

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
  email: "john@stewardshipcre.com",
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

function buildPrompt(ctx: PersonalizationContext): { system: string; userText: string } {
  const angle = archetypeAngle(ctx.archetype);
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

  const system = `You write outreach messages on behalf of a commercial real estate broker.

${VOICE_INSTRUCTIONS}

ANGLE FOR THIS MESSAGE:
${angle}

CHANNEL:
${channelMeta}

OUTPUT FORMAT — return ONLY a JSON object with these fields:
{
  "subject": "string (empty for SMS)",
  "body": "string — the actual message",
  "rationale": "one sentence on what fact you anchored the message on"
}

Do not include any text outside the JSON object. Do not wrap in markdown code fences.`;

  const userText = `Write a ${ctx.channel === "sms" ? "single SMS" : "single email"} to this recipient about this property.

PROPERTY:
${propLines.length > 0 ? propLines.join("\n") : "(no property details provided)"}

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
  const { system, userText } = buildPrompt(ctx);
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
  // For warm leads (any engagement signal), use the followup archetype
  if (opts.leadInterestLevel) {
    return "warm_lead_followup";
  }
  return "generic";
}
