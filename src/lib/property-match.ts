/**
 * Match an inbound lead's text references to a property in the CRM.
 *
 * Strategy (in order of confidence):
 *   1. Listing URL — a CREXi/LoopNet listing id that is one of ours wins
 *      outright; a listing URL that is NOT ours means the sender is talking
 *      about someone else's property, so we stop and return no match.
 *   2. Exact slug match in URL or subject
 *   3. Address match — street number AND street name, as whole words
 *   4. Property name match (whole-word token overlap)
 *
 * Steps 3–4 only look at the subject, the AI's property hint, and the body
 * above the signature / quoted reply. A sender's own address block and an
 * older message in the thread are not what they are asking about, and loose
 * substring matching against them is how Park 84's leasing manager got an
 * auto-receipt about "Tru by Hilton Merrillville" (Oct 2026).
 *
 * Returns the best candidate plus a confidence score (0-1). Below the
 * MATCH_CONFIDENCE_THRESHOLD the orchestrator treats the lead as
 * unmatched — flagged for John, no auto-ack.
 */

export interface PropertyCandidate {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  slug: string | null;
  asset_type: string | null;
  crexi_url: string | null;
  loopnet_url?: string | null;
  publish_to_website: boolean | null;
}

export interface PropertyMatchResult {
  property: PropertyCandidate | null;
  confidence: number; // 0-1
  reasons: string[];
}

export const MATCH_CONFIDENCE_THRESHOLD = 0.5;

/** A match this strong may be named back to the sender in an unattended receipt. */
export const ACK_CONFIDENCE_THRESHOLD = 0.8;

const STREET_SUFFIXES = new Set([
  "st", "street", "rd", "road", "dr", "drive", "ave", "av", "avenue", "blvd", "boulevard",
  "ln", "lane", "ct", "court", "pl", "place", "way", "hwy", "highway", "pkwy", "parkway",
  "cir", "circle", "ter", "terrace", "trl", "trail", "sq", "square", "plz", "plaza",
  "n", "s", "e", "w", "ne", "nw", "se", "sw", "north", "south", "east", "west",
  "suite", "ste", "unit", "us", "sr", "route", "rte",
]);

const NAME_STOPWORDS = new Set(["the", "and", "for", "with", "building", "center", "property", "plaza"]);

/** Lower-cased word list; keeps "84th", "7880-7896" style tokens intact. */
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

/**
 * The part of an email that is actually the sender's message: drop the
 * signature (RFC "-- " delimiter or a lone "--") and anything quoted from an
 * earlier message in the thread.
 */
export function messageCore(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "--" || t === "-- " || t === "__") break;
    if (/^on .{3,200} wrote:$/i.test(t)) break;
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(t)) break;
    if (/^from:\s/i.test(t) && out.length > 0) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n");
}

function listingIds(text: string): { crexi: string[]; loopnet: string[] } {
  const crexi = Array.from(text.matchAll(/crexi\.com\/[^\s)>"']*?properties\/(\d+)/gi)).map((m) => m[1]);
  const loopnet = Array.from(text.matchAll(/loopnet\.com\/listing\/[^\s)>"']*?\/(\d{5,})/gi)).map((m) => m[1]);
  return { crexi, loopnet };
}

function storedId(url: string | null | undefined, kind: "crexi" | "loopnet"): string | null {
  if (!url) return null;
  const m = kind === "crexi" ? url.match(/properties\/(\d+)/i) : url.match(/listing\/[^\s]*?\/(\d{5,})/i);
  return m ? m[1] : null;
}

/** Score an address against the message: number + street name must both appear as whole words. */
export function addressScore(address: string, city: string | null, msgWords: Set<string>): number {
  const tokens = words(address);
  const numbers = tokens.filter((t) => /^\d+(-\d+)?$/.test(t)).flatMap((t) => t.split("-"));
  const streetWords = tokens.filter((t) => !/^\d+(-\d+)?$/.test(t) && !STREET_SUFFIXES.has(t));
  if (numbers.length === 0 || streetWords.length === 0) return 0;

  const numberHit = numbers.some((n) => msgWords.has(n));
  if (!numberHit) return 0;
  const streetHits = streetWords.filter((t) => msgWords.has(t)).length;
  const streetScore = streetHits / streetWords.length;
  if (streetScore < 0.5) return 0;

  const cityHit = city ? words(city).every((t) => msgWords.has(t)) : false;
  return Math.min(1, 0.6 + 0.3 * streetScore + (cityHit ? 0.1 : 0));
}

export async function matchProperty(
  supabase: any,
  organizationId: string,
  hints: {
    raw_subject?: string | null;
    raw_body?: string | null;
    property_label?: string | null; // AI-extracted hint
  }
): Promise<PropertyMatchResult> {
  const reasons: string[] = [];
  const fullText = [hints.raw_subject || "", hints.raw_body || "", hints.property_label || ""].join(" ").toLowerCase();

  if (!fullText.trim()) {
    return { property: null, confidence: 0, reasons: ["No text to match against"] };
  }

  // Pull a working set. Single broker; properties table is small.
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, name, headline, address, city, state, slug, asset_type, crexi_url, loopnet_url, publish_to_website")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !properties) {
    return { property: null, confidence: 0, reasons: [`DB error: ${error?.message || "unknown"}`] };
  }

  // ── 1. Listing URLs ───────────────────────────────────────────────────────
  const ids = listingIds(fullText);
  for (const p of properties as any[]) {
    const crexiId = storedId(p.crexi_url, "crexi");
    if (crexiId && ids.crexi.includes(crexiId)) {
      reasons.push(`CREXi listing ID match: ${crexiId}`);
      return { property: p, confidence: 1.0, reasons };
    }
    const loopnetId = storedId(p.loopnet_url, "loopnet");
    if (loopnetId && ids.loopnet.includes(loopnetId)) {
      reasons.push(`LoopNet listing ID match: ${loopnetId}`);
      return { property: p, confidence: 1.0, reasons };
    }
  }
  if (ids.crexi.length || ids.loopnet.length) {
    const which = [...ids.crexi.map((i) => `CREXi ${i}`), ...ids.loopnet.map((i) => `LoopNet ${i}`)].join(", ");
    reasons.push(`Links to a listing that isn't ours (${which}) — not matching on looser signals`);
    return { property: null, confidence: 0, reasons };
  }

  // ── 2. Slug match (stewardshipcre.com links) ──────────────────────────────
  for (const p of properties as any[]) {
    if (p.slug && fullText.includes(`/${p.slug}`)) {
      reasons.push(`Slug match: ${p.slug}`);
      return { property: p, confidence: 0.95, reasons };
    }
  }

  // Looser signals only look at what the sender actually wrote.
  const core = [hints.raw_subject || "", messageCore(hints.raw_body || ""), hints.property_label || ""].join("\n");
  const msgWords = new Set(words(core));

  // ── 3. Address match ──────────────────────────────────────────────────────
  let bestAddress: { p: PropertyCandidate; score: number } | null = null;
  for (const p of properties as any[]) {
    if (!p.address) continue;
    const score = addressScore(p.address, p.city, msgWords);
    if (score > 0 && (!bestAddress || score > bestAddress.score)) bestAddress = { p, score };
  }
  if (bestAddress) {
    reasons.push(`Address match for ${bestAddress.p.address}, ${bestAddress.p.city} (score ${bestAddress.score.toFixed(2)})`);
    return { property: bestAddress.p, confidence: bestAddress.score, reasons };
  }

  // ── 4. Property name match (whole words) ──────────────────────────────────
  const coreLower = ` ${words(core).join(" ")} `;
  let bestName: { p: PropertyCandidate; score: number } | null = null;
  for (const p of properties as any[]) {
    for (const cand of [p.name, p.headline].filter(Boolean) as string[]) {
      const candWords = words(cand);
      if (candWords.join(" ").length < 8) continue; // generic names are noise

      if (coreLower.includes(` ${candWords.join(" ")} `)) {
        if (!bestName || bestName.score < 0.85) bestName = { p, score: 0.85 };
        continue;
      }
      const tokens = candWords.filter((t) => t.length > 3 && !NAME_STOPWORDS.has(t));
      if (tokens.length < 2) continue;
      const hitRatio = tokens.filter((t) => msgWords.has(t)).length / tokens.length;
      if (hitRatio > 0.6) {
        const score = hitRatio * 0.7; // partial matches never reach the receipt threshold
        if (!bestName || score > bestName.score) bestName = { p, score };
      }
    }
  }
  if (bestName) {
    reasons.push(`Name match: "${bestName.p.name}" (score ${bestName.score.toFixed(2)})`);
    return { property: bestName.p, confidence: bestName.score, reasons };
  }

  reasons.push("No property reference found");
  return { property: null, confidence: 0, reasons };
}
