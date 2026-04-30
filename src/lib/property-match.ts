/**
 * Match an inbound lead's text references to a property in the CRM.
 *
 * Strategy (in order of confidence):
 *   1. Exact CREXi listing URL → property.crexi_url
 *   2. Exact slug match in URL or subject
 *   3. Address match (street + city)
 *   4. Property name match (token overlap)
 *
 * Returns the best candidate plus a confidence score (0-1). Below the
 * MATCH_CONFIDENCE_THRESHOLD the orchestrator treats the lead as
 * unmatched — flagged for John, no auto-ack.
 */

import { createClient } from "@supabase/supabase-js";

export interface PropertyCandidate {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  slug: string | null;
  asset_type: string | null;
  crexi_url: string | null;
  publish_to_website: boolean | null;
}

export interface PropertyMatchResult {
  property: PropertyCandidate | null;
  confidence: number; // 0-1
  reasons: string[];
}

export const MATCH_CONFIDENCE_THRESHOLD = 0.5;

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
  const haystack = [
    hints.raw_subject || "",
    hints.raw_body || "",
    hints.property_label || "",
  ]
    .join(" ")
    .toLowerCase();

  if (!haystack.trim()) {
    return { property: null, confidence: 0, reasons: ["No text to match against"] };
  }

  // Pull a working set. Single broker; properties table is small.
  const { data: properties, error } = await supabase
    .from("properties")
    .select("id, name, address, city, state, slug, asset_type, crexi_url, publish_to_website")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !properties) {
    return { property: null, confidence: 0, reasons: [`DB error: ${error?.message || "unknown"}`] };
  }

  // ── 1. CREXi URL match ────────────────────────────────────────────────────
  const crexiUrlMatch = haystack.match(/https?:\/\/(?:www\.)?crexi\.com\/[^\s)>"']+/);
  if (crexiUrlMatch) {
    const incomingUrl = crexiUrlMatch[0].toLowerCase();
    for (const p of properties as any[]) {
      if (p.crexi_url && incomingUrl.includes(p.crexi_url.toLowerCase().replace(/^https?:\/\/(?:www\.)?/, ""))) {
        reasons.push(`CREXi URL exact match: ${p.crexi_url}`);
        return { property: p, confidence: 1.0, reasons };
      }
      // Also try matching the listing ID portion of the URL
      const incomingIdMatch = incomingUrl.match(/properties\/(\d+)/);
      const storedIdMatch = (p.crexi_url || "").match(/properties\/(\d+)/);
      if (incomingIdMatch && storedIdMatch && incomingIdMatch[1] === storedIdMatch[1]) {
        reasons.push(`CREXi listing ID match: ${incomingIdMatch[1]}`);
        return { property: p, confidence: 1.0, reasons };
      }
    }
  }

  // ── 2. Slug match (from URL paths or stewardshipcre.com links) ────────────
  for (const p of properties as any[]) {
    if (p.slug && haystack.includes(`/${p.slug}`)) {
      reasons.push(`Slug match: ${p.slug}`);
      return { property: p, confidence: 0.95, reasons };
    }
  }

  // ── 3. Address match ──────────────────────────────────────────────────────
  let bestAddress: { p: PropertyCandidate; score: number } | null = null;
  for (const p of properties as any[]) {
    if (!p.address) continue;
    const addr = p.address.toLowerCase();
    const city = (p.city || "").toLowerCase();

    // Tokenize address: ignore "St", "Rd", "Drive" etc — just check core tokens.
    const addrTokens = addr.split(/\s+/).filter((t: string) => t.length > 1);
    const numTokens = addrTokens.length;
    const hits = addrTokens.filter((t: string) => haystack.includes(t)).length;
    const addrScore = numTokens > 0 ? hits / numTokens : 0;

    const cityHit = city && haystack.includes(city) ? 0.3 : 0;
    const score = Math.min(1, addrScore * 0.7 + cityHit + (haystack.includes(addr) ? 0.4 : 0));

    if (score > 0.6 && (!bestAddress || score > bestAddress.score)) {
      bestAddress = { p, score };
    }
  }
  if (bestAddress) {
    reasons.push(
      `Address match for ${bestAddress.p.address}, ${bestAddress.p.city} (score ${bestAddress.score.toFixed(2)})`
    );
    return { property: bestAddress.p, confidence: bestAddress.score, reasons };
  }

  // ── 4. Property name match (token overlap, weighted by token length) ──────
  let bestName: { p: PropertyCandidate; score: number } | null = null;
  for (const p of properties as any[]) {
    const candidates = [p.name, p.headline].filter(Boolean) as string[];
    for (const cand of candidates) {
      const candLower = cand.toLowerCase();
      // Skip generic single-word names ("retail", "office") — too noisy
      if (candLower.length < 8) continue;

      if (haystack.includes(candLower)) {
        if (!bestName || 0.85 > bestName.score) {
          bestName = { p, score: 0.85 };
        }
      } else {
        const tokens = candLower.split(/\s+/).filter((t: string) => t.length > 3);
        if (tokens.length === 0) continue;
        const hits = tokens.filter((t: string) => haystack.includes(t)).length;
        const score = hits / tokens.length;
        if (score > 0.6 && (!bestName || score > bestName.score)) {
          bestName = { p, score: score * 0.7 }; // discount partial token matches
        }
      }
    }
  }
  if (bestName) {
    reasons.push(`Name token match: "${bestName.p.name}" (score ${bestName.score.toFixed(2)})`);
    return { property: bestName.p, confidence: bestName.score, reasons };
  }

  reasons.push("No property reference found");
  return { property: null, confidence: 0, reasons };
}
