/**
 * Heuristic spam pre-filter for inbound leads. Cheap pass before we
 * burn Claude tokens on obvious vendor pitches.
 *
 * Returns a verdict + reason. Borderline cases bubble up to a Haiku
 * classifier in the intake orchestrator.
 */

export type SpamVerdict = "spam" | "borderline" | "clean";

export interface SpamCheckInput {
  sender_email?: string | null;
  sender_name?: string | null;
  subject?: string | null;
  body?: string | null;
}

export interface SpamCheckResult {
  verdict: SpamVerdict;
  reasons: string[];
}

// Domains that are almost always vendor outreach to brokers.
const HARD_SPAM_DOMAINS = [
  "seoexpertusa.com",
  "linkbuilderhq.com",
  "marketingboost.com",
  "growthhackers.io",
];

// Phrase signals — case-insensitive substring matches in subject or body.
const SPAM_PHRASES = [
  "rank higher on google",
  "seo services",
  "increase your traffic",
  "boost your website",
  "guest post",
  "link exchange",
  "cold email outreach",
  "lead generation services",
  "appointment setting service",
  "outsource your",
  "hire a virtual assistant",
  "press release distribution",
  "guaranteed first page",
  "submit your site",
  "recruitment opportunity",
  "join our affiliate",
  "we found your website",
  "your website is missing",
  "free audit of your site",
];

const SUSPICIOUS_PHRASES = [
  "limited time offer",
  "act now",
  "100% free",
  "no obligation",
];

export function checkSpam(input: SpamCheckInput): SpamCheckResult {
  const reasons: string[] = [];
  const haystack = `${input.subject || ""} ${input.body || ""}`.toLowerCase();
  const senderDomain = (input.sender_email || "").split("@")[1]?.toLowerCase() || "";

  if (senderDomain && HARD_SPAM_DOMAINS.includes(senderDomain)) {
    reasons.push(`Sender domain ${senderDomain} is a known vendor source`);
    return { verdict: "spam", reasons };
  }

  let phraseHits = 0;
  for (const phrase of SPAM_PHRASES) {
    if (haystack.includes(phrase)) {
      reasons.push(`Spam phrase: "${phrase}"`);
      phraseHits += 1;
    }
  }
  if (phraseHits >= 2) {
    return { verdict: "spam", reasons };
  }

  // Link density — many links + short body = likely promotional
  const linkCount = (haystack.match(/https?:\/\//g) || []).length;
  const bodyLen = (input.body || "").length;
  if (linkCount >= 5 && bodyLen < 1500) {
    reasons.push(`High link density (${linkCount} links in ${bodyLen} chars)`);
    if (phraseHits >= 1) return { verdict: "spam", reasons };
    reasons.push("Borderline — check content");
    return { verdict: "borderline", reasons };
  }

  let suspiciousHits = 0;
  for (const phrase of SUSPICIOUS_PHRASES) {
    if (haystack.includes(phrase)) {
      reasons.push(`Suspicious phrase: "${phrase}"`);
      suspiciousHits += 1;
    }
  }
  if (suspiciousHits >= 2 || phraseHits === 1) {
    return { verdict: "borderline", reasons };
  }

  if (reasons.length === 0) reasons.push("No spam signals detected");
  return { verdict: "clean", reasons };
}
