/**
 * Helpers shared across the owner-dashboard surface area:
 *   - Week-boundary math (Monday–Sunday windows)
 *   - Extension API-key auth
 *   - Token + secret generation
 *   - Anonymized lead summary builder
 */

import { createHash } from "crypto";

export const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// ── Token + secret generation ──────────────────────────────────────────────

export function generateToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

// ── Week math (ISO Monday–Sunday) ──────────────────────────────────────────

export function startOfWeek(date: Date = new Date()): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun, 1 = Mon, ...
  const diff = (dow + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function endOfWeek(date: Date = new Date()): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return end;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weeksBack(n: number): Array<{ start: Date; end: Date }> {
  const out: Array<{ start: Date; end: Date }> = [];
  for (let i = 0; i < n; i++) {
    const ref = new Date();
    ref.setUTCDate(ref.getUTCDate() - i * 7);
    out.push({ start: startOfWeek(ref), end: endOfWeek(ref) });
  }
  return out;
}

// ── Anonymized lead summary ────────────────────────────────────────────────
// Owners see "1031 buyer · $4M · 60-day timeline" — never names or contact info.

export function anonymizeLead(lead: {
  intent?: string | null;
  urgency?: string | null;
  qualifier_summary?: string | null;
  raw_subject?: string | null;
}): string {
  if (lead.qualifier_summary && lead.qualifier_summary.length > 4) {
    // Strip any obvious name patterns just in case
    return lead.qualifier_summary
      .replace(/\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+[A-Z][a-z]+\b/g, "")
      .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, (match) => {
        // Light heuristic: if it looks like "First Last", drop it.
        // Two capitalized words could also be place names — accept some FP.
        return /[A-Z][a-z]+ (Inc|LLC|Corp|Group|Holdings|Capital|Partners|Realty|Properties)/.test(match)
          ? match
          : "";
      })
      .replace(/\s+/g, " ")
      .trim();
  }
  const intent = lead.intent || "inquiry";
  const urgency = lead.urgency ? ` · ${lead.urgency}` : "";
  return `${intent}${urgency}`;
}

// ── User-Agent → coarse summary ────────────────────────────────────────────
// "Chrome/Mac" — no fingerprint, just a feel for traffic shape.

export function summarizeUA(ua: string | null): string {
  if (!ua) return "unknown";
  let browser = "browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";
  let os = "device";
  if (/iphone|ipad/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/macintosh|mac os/i.test(ua)) os = "Mac";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/linux/i.test(ua)) os = "Linux";
  return `${browser}/${os}`;
}

// ── IP → hash (with rotating salt — for now just env or constant) ──────────

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.PAGE_VIEW_HASH_SALT || "stewardship-cre-2026";
  return createHash("sha256").update(ip + salt, "utf8").digest("hex").slice(0, 16);
}
