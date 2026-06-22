/**
 * Listing description generator — first asset in the marketing engine.
 *
 * Single-shot Sonnet call. Takes the resolved property context and
 * returns a structured payload the API persists to:
 *   properties.headline
 *   properties.description
 *   properties.highlights  (jsonb array of strings)
 *
 * Future generators (flyer, OM, social) share the same context loader
 * and a similar shape — they all take MarketingPropertyContext as
 * input and produce a structured asset payload.
 *
 * The prompt is intentionally fact-led: Claude gets the property + the
 * comp set + the broker voice rules, and is told to lead with what
 * the numbers actually support. No "elevate", no "premier", no fluff —
 * exactly the voice rules John already curates for Steward.
 */

import { MODELS, callAnthropic, parseJsonResponse } from "@/lib/anthropic";
import type { MarketingPropertyContext } from "./property-context";

export interface GeneratedDescription {
  headline: string;
  description: string;
  /** Physical / use-case bullets — what the building IS. */
  highlights: string[];
  /** Investment-thesis bullets — why someone should BUY it. OM-style. */
  investment_highlights: string[];
  /** Steward-style — facts Claude wanted to flag but couldn't fit. Optional. */
  observations?: string[];
}

const SYSTEM_PROMPT = `You are a senior commercial real estate broker at Stewardship CRE, an Indiana-focused brokerage. You write PUBLIC-FACING marketing copy for commercial listings — copy that goes to CREXi, LoopNet, the firm website, and teaser emails where prospective buyers/tenants see it BEFORE signing a CA.

CRITICAL FRAMING — what this copy IS and is NOT:

This is MARKETING COPY for a seller. It sells the OPPORTUNITY.
This is NOT an underwriting memo. It is NOT a buyer's investment analysis. It is NOT a comp set.

You will be given comp data, pricing benchmarks, and broker voice rules as CONTEXT. Use them to choose your angle, tone, and which physical attributes to emphasize. NEVER quote them in the output.

What public marketing copy DOES:
- Describes the building physically — SF, year built, stories, zoning, parking, configuration
- Frames the USE CASES — "owner-user", "subdividable multi-tenant flex", "operator looking for X"
- Highlights flexibility and optionality where it exists
- Mentions location advantages in plain terms — "I-65 corridor", "established Merrillville industrial market", "minutes from [interstate]"
- Soft CTA — "tour by appointment", "OM available upon CA execution", "contact broker for details"

What public marketing copy NEVER does:
- Mention specific comp addresses, sale prices, or lease rates (e.g. "3803 E Lincoln Hwy sold at $93.70/SF" — FORBIDDEN)
- Position price relative to market ("15% above median", "below market $/SF" — FORBIDDEN)
- Quote stabilized income or pro forma math ("approximately $407,000 annually" — FORBIDDEN)
- Describe the seller's rationale or pricing motive ("the seller is seeking a premium for..." — FORBIDDEN)
- Frame the property as if explaining it to a financial buyer ("fits an investor with a 7% target yield" — FORBIDDEN)
- Use sell-side / buy-side memo language: "broadens the buyer pool", "qualified buyer pool", "expand the investor base", "favorable exit", "favorable resale", "at exit", "at resale" — FORBIDDEN. These are broker-to-broker phrases that read as analytical, not aspirational. Just describe the ASSET's qualities directly ("M1 zoning permits broad industrial uses") instead of editorializing about its market positioning ("M1 zoning broadens the qualified buyer pool")
- Use vague-significance filler — "meaningful size in this submarket", "meaningful scale", "notable footprint", "significant presence", "well-positioned in the market", "strong market dynamics", "compelling opportunity", "attractive submarket" — FORBIDDEN. These sentences carry no information. Either give a CONCRETE fact ("37,000 SF — supports a single user or 3-4 tenant subdivision") or DROP the bullet entirely. 5 sharp bullets beats 6 with filler. If you can't say something concrete, leave it out per the "skip if no data, don't pad" rule
- Mention asking price in the body (the headline and listing platform show the price; the body sells the OPPORTUNITY, not the price)

Voice:
- Direct, peer-level, no marketing fluff
- Concrete physical details and use cases over adjectives
- NEVER use these words/phrases: "vintage", "elevate", "premier", "leverage", "best-in-class", "unparalleled", "state-of-the-art", "world-class", "luxury", "iconic", "incredible opportunity", "rare opportunity", "don't miss", "won't last", "must-see"
- Avoid: rhetorical questions, exclamation points, all caps
- When the data is thin, KEEP THE COPY SHORT. Less is more.

Output is structured JSON ONLY. No preamble, no closing remarks. Schema:

{
  "headline": "string — building-led, ≤70 chars. Examples: '37,000 SF Flex Industrial — Merrillville, IN' or 'Anchored Retail Center — 48k SF — Lake County' or '4-Acre Industrial Site — Crown Point'. Do NOT lead with price. Do NOT include '$X/SF' or cap rate.",
  "description": "string — 120-220 words. 2-4 short paragraphs. Para 1: building + location + the headline use case. Para 2: flexibility / use-case options / zoning context. Para 3 (optional): location/access. Last sentence: soft CTA. NEVER quote comps, prices, pro forma math, or market positioning.",
  "highlights": ["string", "..."] — 4-6 PHYSICAL / USE-CASE bullets, 5-12 words each. What the building IS and how it can be used. Examples: '37,000 SF flex industrial, M1 zoning' / '1.82-acre site — room for outdoor storage' / 'Vacant — immediate owner-user occupancy'.",
  "investment_highlights": ["string", "..."] — 4-7 INVESTMENT-THESIS bullets, 6-14 words each. Why a buyer should buy. THESIS-level only. Examples: 'Owner-user play — build equity vs. paying rent' / 'M1 zoning expands the qualified buyer pool at exit' / 'Vacant delivery — buyer controls timing and configuration' / 'Subdivision potential for multi-tenant income mix' / '1031-exchange eligible'. FORBIDDEN in these bullets (same as description): specific comp addresses, '$X/SF above median', 'X% cap rate', stabilized income figures, 'below replacement cost' unless replacement cost is in the data, or any other pricing/comp-positioning content. Thesis only — abstract investor angles. If you cannot say something thesis-level without quoting comps or prices, OMIT it.",
  "observations": ["string", "..."] — INTERNAL ONLY, never goes public. Things YOU as the agent want to flag to John: data gaps, comp warnings, listing risks, things to confirm with the seller. Each one a single sentence.
}

Hard rules:
- Output ONLY the JSON. No fenced code block, no commentary.
- If a fact is null/unknown, do NOT invent it. Either omit it from the copy or flag it in observations.
- Never assert tenant names, environmental status, roof/HVAC condition, or any other fact unless it's explicitly in the data.
- The headline describes the BUILDING and ASSET TYPE, not the price.
- Public copy stays in the building's voice; the underwriting math, comps, and pricing analysis NEVER appear in public-facing fields.`;

function buildUserMessage(ctx: MarketingPropertyContext): string {
  const p = ctx.property;
  const c = ctx.computed;
  const voice = ctx.voiceProfile;

  const lines: string[] = [];

  lines.push("=== PROPERTY FACTS ===");
  lines.push(JSON.stringify(
    {
      name: p.name,
      address: p.address,
      city: p.city,
      state: p.state,
      zip: p.zip,
      asset_type: p.asset_type,
      sub_type: p.sub_type,
      transaction_type: p.transaction_type,
      asking_price: p.asking_price,
      lease_rate: p.lease_rate,
      sqft: p.sqft,
      units: p.units,
      acreage: p.acreage,
      year_built: p.year_built,
      building_class: p.building_class,
      number_of_stories: p.number_of_stories,
      parking_spaces: p.parking_spaces,
      parking_ratio: p.parking_ratio,
      zoning: p.zoning,
      tenancy: p.tenancy,
      occupancy_pct: p.occupancy_pct,
      percent_leased: p.percent_leased,
      noi: p.noi,
      cap_rate: p.cap_rate,
      market_name: p.market_name,
      submarket: p.submarket,
      county: p.county,
    },
    null,
    2
  ));

  lines.push("");
  lines.push("=== COMPUTED SIGNALS ===");
  lines.push(JSON.stringify(c, null, 2));

  if (ctx.saleComps.length > 0) {
    lines.push("");
    lines.push(`=== RECENT SALE COMPS (${ctx.saleComps.length} in same city + asset_type, last 36 months) ===`);
    lines.push(JSON.stringify(ctx.saleComps, null, 2));
  } else {
    lines.push("");
    lines.push("=== SALE COMPS ===");
    lines.push("No comparable sales in the database for this city + asset_type in the last 36 months.");
  }

  if (ctx.leaseComps.length > 0) {
    lines.push("");
    lines.push(`=== RECENT LEASE COMPS (${ctx.leaseComps.length} in same city + asset_type, last 36 months) ===`);
    lines.push(JSON.stringify(ctx.leaseComps, null, 2));
  } else {
    lines.push("");
    lines.push("=== LEASE COMPS ===");
    lines.push("No comparable leases in the database for this city + asset_type in the last 36 months.");
  }

  if (voice) {
    lines.push("");
    lines.push("=== BROKER VOICE RULES (apply on top of system prompt) ===");
    lines.push(JSON.stringify(voice, null, 2));
  }

  lines.push("");
  lines.push("Produce the JSON. Output the object only.");

  return lines.join("\n");
}

export async function generateDescription(ctx: MarketingPropertyContext): Promise<GeneratedDescription> {
  const userMessage = buildUserMessage(ctx);

  const response = await callAnthropic({
    model: MODELS.SONNET,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 2048,
    temperature: 0.5,
  });

  const parsed = parseJsonResponse<GeneratedDescription>(response.text);
  if (!parsed) {
    throw new Error(
      `Description generator returned non-JSON. Raw: ${response.text.slice(0, 400)}`
    );
  }
  // Normalize: ensure all array fields are arrays of strings.
  if (!Array.isArray(parsed.highlights)) parsed.highlights = [];
  parsed.highlights = parsed.highlights.map((h) => String(h)).slice(0, 8);
  if (!Array.isArray(parsed.investment_highlights)) parsed.investment_highlights = [];
  parsed.investment_highlights = parsed.investment_highlights.map((h) => String(h)).slice(0, 8);
  parsed.headline = String(parsed.headline ?? "").trim();
  parsed.description = String(parsed.description ?? "").trim();
  if (parsed.observations && !Array.isArray(parsed.observations)) {
    parsed.observations = [String(parsed.observations)];
  }
  return parsed;
}
