/**
 * CRE OS — Haiku-backed AI synthesis surfaces.
 *
 * Phase 4 introduces the first real LLM-backed surface: a one-sentence
 * editorial summary on the contact workspace ("Most engaged buyer rep in
 * your book — touched 4 of your listings this quarter…"). Rule-based
 * synthesis gets us 80% of the way; Haiku closes the last 20% where the
 * sentence needs to *read* like a human noticed something specific.
 *
 * Cost / latency posture (per the $2/day budget agreed in Phase 0):
 *   • Daily cache per record (in-memory Map, key = entity_id+date)
 *   • Prompt-cached system message (the persona + format rules)
 *   • Falls back to deterministic synthesis on any error or missing key
 *   • Haiku 4.5 — fastest current model, ~3¢ per call uncached
 *
 * Public:
 *   summarizeContact(detail) → string  (one-sentence synthesis)
 *
 * Both deterministic and AI paths return the same shape, so callers don't
 * branch on which one ran.
 */

import type { ContactDetail } from "./relationship-queries";
import { MODELS } from "@/lib/anthropic";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = MODELS.HAIKU;
const MAX_TOKENS = 200;

const SYSTEM_PROMPT = `You are a senior CRE broker's attentive associate. Given structured facts about a contact, write ONE sentence (15-30 words) that captures what's worth noticing about this relationship right now.

Rules:
- Lead with the most useful observation. Avoid generic openers like "This is..." or "Your contact..."
- Be specific. Reference concrete numbers ("touched 4 listings this quarter", "23 days quiet") when they sharpen the sentence.
- Voice: direct, knowing, broker-to-broker. Never marketing-speak. Never "elevate", "leverage", "premier".
- Return only the sentence. No prefix, no quotes, no markdown.

If the facts are sparse, say so plainly: "New contact — no engagement yet." Don't fabricate.`;

interface CacheEntry {
  date: string; // YYYY-MM-DD
  text: string;
}
const CACHE = new Map<string, CacheEntry>();

/**
 * Generate a one-sentence summary for a contact. Cached for the day. Falls
 * back to deterministic synthesis on any error.
 */
export async function summarizeContact(detail: ContactDetail): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `contact:${detail.id}`;
  const cached = CACHE.get(cacheKey);
  if (cached && cached.date === today) return cached.text;

  // No API key → use deterministic fallback
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const text = deterministicContactSummary(detail);
    CACHE.set(cacheKey, { date: today, text });
    return text;
  }

  try {
    const userPrompt = buildContactFacts(detail);
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      }),
      // 5s timeout — degrade to deterministic rather than block the page
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = await res.json();
    const text = data?.content?.[0]?.text?.trim();
    if (!text) throw new Error("empty response");
    CACHE.set(cacheKey, { date: today, text });
    return text;
  } catch (err) {
    // Swallow + fall back. Deterministic is "good enough" for a synthesis line.
    const text = deterministicContactSummary(detail);
    CACHE.set(cacheKey, { date: today, text });
    return text;
  }
}

/** Build the facts blob fed to Haiku — compact, structured, no fluff. */
function buildContactFacts(c: ContactDetail): string {
  const lines: string[] = [];
  lines.push(`Name: ${c.fullName}`);
  if (c.contactType) lines.push(`Role / type: ${c.contactType}${c.role ? ` · ${c.role}` : ""}`);
  if (c.companyName) lines.push(`Company: ${c.companyName}`);
  lines.push(`Warmth: ${c.warmth} (score ${c.warmthScore}/100)`);
  if (c.daysSinceTouch !== null) lines.push(`Last touched: ${c.daysSinceTouch} days ago`);
  else lines.push(`Last touched: never recorded`);
  lines.push(`Activity in last 90 days: ${c.activityCount90d}`);
  if (c.linkedDeals.length) {
    const open = c.linkedDeals.filter((d) => !d.isClosed && !d.isDead);
    lines.push(`Deals: ${open.length} open, ${c.linkedDeals.length - open.length} closed/dead`);
    if (open.length && open[0].dealName) lines.push(`Top deal: ${open[0].dealName}${open[0].stage ? ` (${open[0].stage})` : ""}`);
  }
  if (c.linkedLeads.length) {
    const hot = c.linkedLeads.filter((l) => l.urgency === "hot");
    lines.push(`Inbound leads: ${c.linkedLeads.length}${hot.length ? ` (${hot.length} hot)` : ""}`);
  }
  if (c.linkedProperties.length) lines.push(`Properties they're linked to: ${c.linkedProperties.length}`);
  if (c.followUpOverdue) lines.push(`Follow-up date passed: ${c.nextFollowUp}`);
  if (c.warmthReasons.length) lines.push(`Warmth reasons: ${c.warmthReasons.join(" · ")}`);
  return lines.join("\n");
}

/** Deterministic fallback — same shape, no API call. */
function deterministicContactSummary(c: ContactDetail): string {
  const bits: string[] = [];

  // Lead with engagement quality
  if (c.warmth === "hot") {
    bits.push(`Strong relationship`);
  } else if (c.warmth === "warm") {
    bits.push(`Active relationship`);
  } else if (c.warmth === "cool") {
    bits.push(`Light engagement`);
  } else {
    bits.push(`Cold relationship`);
  }

  // Followed by recency / volume
  if (c.daysSinceTouch === null) {
    bits.push("with no recorded activity yet.");
  } else if (c.daysSinceTouch <= 1) {
    bits.push("touched in the last 24 hours.");
  } else if (c.daysSinceTouch <= 7) {
    bits.push(`last touched ${c.daysSinceTouch} day${c.daysSinceTouch === 1 ? "" : "s"} ago.`);
  } else if (c.daysSinceTouch <= 30) {
    bits.push(`touched ${c.daysSinceTouch} days ago.`);
  } else {
    bits.push(`quiet for ${c.daysSinceTouch} days.`);
  }

  // Followed by what's in motion
  const open = c.linkedDeals.filter((d) => !d.isClosed && !d.isDead);
  const hot = c.linkedLeads.filter((l) => l.urgency === "hot");
  const tail: string[] = [];
  if (open.length) tail.push(`${open.length} active deal${open.length === 1 ? "" : "s"}`);
  if (hot.length) tail.push(`${hot.length} hot lead${hot.length === 1 ? "" : "s"} pending`);
  if (c.linkedProperties.length >= 3) tail.push(`linked to ${c.linkedProperties.length} properties`);
  if (c.followUpOverdue) tail.push("follow-up date has passed");

  if (tail.length) bits.push(`${tail.join(", ")}.`);

  return bits.join(" ");
}
