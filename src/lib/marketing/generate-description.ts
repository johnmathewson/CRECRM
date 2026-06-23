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
      // Lease-specific facts — populated only on for-lease properties.
      // Surfaced to the model so the lease-mode addendum has the data
      // it needs to write tenant-facing copy.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lease_type: (p as any).lease_type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      available_sf: (p as any).available_sf,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      divisible_to_sf: (p as any).divisible_to_sf,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lease_term_months: (p as any).lease_term_months,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ti_allowance_per_sf: (p as any).ti_allowance_per_sf,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      free_rent_months: (p as any).free_rent_months,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      permitted_uses: (p as any).permitted_uses,
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

/**
 * Lease-mode addendum stacked on top of the base system prompt when
 * the property is for lease. The base prompt is sale-oriented
 * (investor / owner-user / cap rate framing); leasing copy speaks
 * to TENANTS, not buyers. Different audience, different language,
 * different forbidden words.
 *
 * Append-only — the base prompt's "never sound like marketing fluff"
 * rules and the JSON schema still apply.
 */
const LEASE_MODE_ADDENDUM = `

═════════════════════════════════════════════════════════════════════
LEASE-MODE OVERRIDES (transaction_type = "lease")
═════════════════════════════════════════════════════════════════════

This property is offered for LEASE, not sale. Your audience is
TENANTS (or their brokers) — businesses looking for space — not
investors. Adjust framing accordingly.

NEVER USE IN LEASE COPY (the sale-side prompt above forbids many of
these already; the additional ones below are lease-specific):
- "Owner-user", "investor", "investment opportunity", "cap rate",
  "yield", "exit", "resale", "buyer pool", "stabilized value",
  "value-add through acquisition" — these are all buyer language
- Sale-deal mechanics: "asking price", "offer price", "1031 exchange",
  "fee simple", "subject to inspection"

USE IN LEASE COPY:
- TENANT-oriented framing: "space for", "operator", "tenant",
  "lease term", "buildout", "TI allowance", "move-in"
- USE CASES: what businesses fit the space (restaurant, retail,
  office, medical, light industrial)
- BUILDOUT FLEXIBILITY: divisibility, vanilla shell vs second-gen,
  TI allowance, white-box condition
- LOCATION FOR TENANT: traffic counts, anchor co-tenants, daytime
  population, drive-time access — not "investment-grade location"
- TERM AND ECONOMICS: lease type (NNN / gross / modified), term,
  rate per SF — only when the data exists. Do NOT speculate.
- PERMITTED USES: what the lease allows (when permitted_uses is set)

SCHEMA OVERRIDES for lease mode:

- "headline": building-led, tenant-oriented. Examples:
  "12,000 SF Anchor Space — Liberty Square, Merrillville"
  "1,200-4,800 SF Retail Suites — High-Traffic Broadway Corridor"
  "Single-Tenant Industrial Flex — 30,000 SF Available — Merrillville"
  Do NOT lead with rate. Do NOT include "$X/SF" in the headline.

- "description": Para 1: space + location + the headline use case.
  Para 2: buildout flexibility / divisibility / use cases / TI.
  Para 3 (optional): traffic / co-tenant / area context.
  Last sentence: soft tour CTA.

- "investment_highlights": these are LEASE / TENANT highlights, not
  investor highlights. THESIS-level bullets for a tenant: why this
  space fits a real operation. Examples:
    "Divisible from 4,800 SF down to 1,200 SF — fits range of operators"
    "Anchor co-tenant traffic — proven destination retail draws"
    "Drive-up frontage on Broadway — strong visibility for retail"
    "TI allowance available for vanilla buildout — reduces tenant cash-in"
    "Second-generation restaurant condition — saves $40-60/SF on buildout"
  FORBIDDEN (same as sale mode plus): "cap rate", "yield",
  "investor", "owner-user", "exit", anything sale-mechanics.

- "highlights": PHYSICAL / configuration bullets — what the space IS.
  Examples: "Vanilla shell white-boxed", "Drive-thru capable",
  "Three-phase 400-amp service", "12-ft clear height", "Open floor
  plan with two ADA restrooms".

- "observations": Same — internal flags about gaps the broker should
  fill before going wide. E.g. "TI allowance not specified — tenants
  ask this on first contact", "Lease term not specified — most retail
  tenants want a 5+5+5".

The output schema is the same JSON. Same rules about no markdown
fences and no preamble. Only the framing changes.
`;

export async function generateDescription(ctx: MarketingPropertyContext): Promise<GeneratedDescription> {
  const userMessage = buildUserMessage(ctx);

  // Append the lease-mode addendum when the property is for lease.
  // Keeps the base prompt clean for sale-mode (the common case) and
  // makes the lease overrides obvious to maintainers.
  const isLease = ctx.property.transaction_type === "lease";
  const systemPrompt = isLease ? SYSTEM_PROMPT + LEASE_MODE_ADDENDUM : SYSTEM_PROMPT;

  const response = await callAnthropic({
    model: MODELS.SONNET,
    system: systemPrompt,
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
