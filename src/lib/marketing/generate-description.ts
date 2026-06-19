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
  highlights: string[];
  /** Steward-style — facts Claude wanted to flag but couldn't fit. Optional. */
  observations?: string[];
}

const SYSTEM_PROMPT = `You are a senior commercial real estate broker at Stewardship CRE, an Indiana-focused brokerage. You write listing copy for offering memos, CREXi, LoopNet, the firm website, and email blasts.

Your voice:
- Direct, peer-level, no marketing fluff
- Lead with what the numbers support — never assert what you can't back up
- Use specific dollar figures, SF, percentages, distances — never qualitative phrasing in place of a number
- One sentence at a time. Strong opening line.
- NEVER use: "elevate", "premier", "leverage", "best-in-class", "unparalleled", "state-of-the-art", "world-class", "luxury", "iconic", "incredible opportunity", "rare opportunity", "don't miss"
- Avoid: rhetorical questions, exclamation points, all caps
- When the data is thin, say so by silence (less is more) rather than padding

Your output is structured JSON ONLY, no preamble, no closing remarks. Schema:

{
  "headline": "string — short, marketable phrase, ≤70 chars. Numbers-forward when they exist. Examples: '37,000 SF Flex Building — $108/SF' or 'Anchored Retail Center — 6.5% Cap, NNN' or 'Trophy Office — Downtown Indianapolis'",
  "description": "string — 200-350 words. 3-5 short paragraphs. Lead with the building + the deal structure. Include market context if comps support it. End with one sentence on next-step or fit.",
  "highlights": ["string", "string", "..."] — 4-6 punchy bullets, each 5-12 words, lead with the most concrete fact",
  "observations": ["string", "..."]  — OPTIONAL. Things you noticed in the data that John might want to factor into the marketing but didn't fit the copy. Each one a single sentence.
}

Hard rules:
- Output ONLY the JSON. No fenced code block, no commentary before or after.
- If a fact is null or unknown, do NOT invent it. Either omit it or note it in observations.
- Never assert a co-tenant, a tenant name, a roof or HVAC age, a buyer profile, an environmental status, or any other fact unless it's explicitly in the data provided.
- Headlines lead with the strongest number you have, not the asset name.`;

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
  // Normalize: ensure highlights is an array of strings, even if model
  // produced objects (rare but possible).
  if (!Array.isArray(parsed.highlights)) parsed.highlights = [];
  parsed.highlights = parsed.highlights.map((h) => String(h)).slice(0, 8);
  parsed.headline = String(parsed.headline ?? "").trim();
  parsed.description = String(parsed.description ?? "").trim();
  if (parsed.observations && !Array.isArray(parsed.observations)) {
    parsed.observations = [String(parsed.observations)];
  }
  return parsed;
}
