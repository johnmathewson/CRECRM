/**
 * AI-driven intent classifier for inbound email — the routing brain of
 * poll-gmail. Replaces brittle filename-pattern matching with a Claude
 * Haiku call that reads each email and decides what it actually IS:
 *
 *   cadence_reply   → someone replying to one of our outbound touches
 *                      (includes OOO auto-responses)
 *   crexi_report    → CREXi platform export — Lead Report XLSX
 *   data_feed       → other CRE platform data dump (LoopNet, Buildout, CoStar)
 *   direct_inquiry  → fresh inbound inquiry about one of our listings
 *                      (route to lead-intake → auto-ack)
 *   unsubscribe     → explicit opt-out request
 *   spam            → promotional / unrelated / obvious junk
 *   internal        → our own team, family, accountants, internal matters
 *   other           → doesn't fit any bucket
 *
 * Why an AI router instead of regex: filename conventions change (CREXi
 * has used both "Lead Report - X.xlsx" and "Lead_Report_X.xlsx"), forwarders
 * rename attachments, and new data feeds appear constantly. Rule-based
 * detection ages poorly. An LLM reading the subject + body + attachment
 * filenames + sender adapts automatically.
 *
 * Reliability: if Claude fails (network, quota, JSON parse), the classifier
 * returns intent="other" + confidence=0, which routes to the safe
 * lead-intake auto-ack path. The poll-gmail caller is responsible for
 * doing the deterministic gmail-thread-id reply match BEFORE calling this
 * classifier — that path is more reliable than AI for known threaded
 * replies.
 */

import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";

export type InboundIntent =
  | "cadence_reply"
  | "crexi_report"
  | "data_feed"
  | "direct_inquiry"
  | "unsubscribe"
  | "spam"
  | "internal"
  | "other";

export interface InboundEmailFeatures {
  fromAddress: string | null;
  subject: string | null;
  /** First ~1500 chars of the body, plain text. */
  bodyPreview: string;
  /** Attachment filenames (any kind, not just XLSX). */
  attachmentFilenames: string[];
}

export interface InboundClassification {
  intent: InboundIntent;
  /** 0-1 confidence from the model */
  confidence: number;
  /** One-sentence rationale for audit / debugging */
  reasoning: string;
  /** Property name/address the email seems to be about, if any (for inquiries / replies) */
  propertyHint?: string;
  /** Model used + when classified */
  classifiedAt: string;
  model: string;
}

const SYSTEM = `You are an email-routing classifier for a commercial real estate brokerage's inbox (inquiries@stewardshipcre.com).

For each inbound email, decide its INTENT so the system can route it correctly. Return EXACTLY ONE of these eight values:

  cadence_reply   — Someone is REPLYING to a prior cold/warm outreach we sent. Signs: "Re:" in the subject, the body references a specific property we likely listed or pitched, the sender remembers a prior message. Includes out-of-office auto-replies to our outreach (e.g. "I'm traveling, please email me Wednesday").

  crexi_report    — A CREXi platform DATA EXPORT (the daily Lead Report). Signs: subject mentions "Lead Report", attachment is an XLSX with "lead", "report", or a property name in the filename, sender is from crexi.com or a Gmail account that John uses to forward CREXi exports. Body is automated/templated.

  data_feed       — Another CRE platform data dump (LoopNet, Buildout, CoStar reports, similar). Has a structured data attachment (XLSX, CSV, PDF report). Body is system-generated, not a person writing.

  direct_inquiry  — A FRESH inbound inquiry about one of our listings or about CRE services we offer. Not a reply to anything we sent. They're asking for info, a tour, financials, an OM. They might mention a property by name or address.

  unsubscribe     — Explicit opt-out request. Body literally contains "unsubscribe", "remove me from your list", "stop emailing me", "take me off", or similar.

  spam            — Promotional, sales pitches (SEO services, lead-gen offers, courses), unrelated marketing, obvious junk. NOT directly about real estate the broker is buying/selling.

  internal        — From John himself, his family, his team, accountants, attorneys handling INTERNAL matters (not buyer/seller correspondence on a listing). Newsletters from John's professional associations also fit here.

  other           — Doesn't fit any bucket. Be conservative — only use when truly ambiguous.

RULES:
1. Look at the WHOLE picture: sender + subject + body + attachments. Don't classify based on subject alone.
2. CREXi exports almost always have "Lead Report" in the subject AND a .xlsx attachment. Either signal alone is suggestive; both together is conclusive.
3. A reply to our outreach typically has "Re:" in subject AND references something specific (a property, a question we asked). If the body is short ("not interested" / "remove me") + it's a reply, it's STILL a cadence_reply (let the system handle the de-engagement downstream).
4. Direct inquiries are FROM external people asking ABOUT a property. The body will sound like a buyer or broker reaching out, not a system-generated report.
5. When confidence is below 0.6, return intent="other" — better to surface to the human than mis-route.

OUTPUT FORMAT — return ONLY a JSON object:
{
  "intent": "one of the 8 values above",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence on what made you decide this",
  "propertyHint": "property name/address if discernible, else null"
}

Do not include any text outside the JSON object. No markdown code fences.`;

export async function classifyInboundEmail(features: InboundEmailFeatures): Promise<InboundClassification> {
  const userText = `Classify this inbound email.

FROM: ${features.fromAddress ?? "(unknown)"}
SUBJECT: ${features.subject ?? "(no subject)"}

BODY (first 1500 chars):
${features.bodyPreview.slice(0, 1500)}

ATTACHMENTS:
${features.attachmentFilenames.length > 0
  ? features.attachmentFilenames.map((f) => `  - ${f}`).join("\n")
  : "  (none)"}

Return JSON only.`;

  try {
    const result = await callAnthropic({
      model: MODELS.HAIKU,
      system: SYSTEM,
      messages: [{ role: "user", content: userText }],
      maxTokens: 512,
      temperature: 0.2, // low — classification benefits from determinism
    });

    const parsed = parseJsonResponse<{
      intent?: string;
      confidence?: number;
      reasoning?: string;
      propertyHint?: string;
    }>(result.text);

    const validIntents: InboundIntent[] = [
      "cadence_reply", "crexi_report", "data_feed", "direct_inquiry",
      "unsubscribe", "spam", "internal", "other",
    ];
    const intent: InboundIntent =
      parsed?.intent && validIntents.includes(parsed.intent as InboundIntent)
        ? (parsed.intent as InboundIntent)
        : "other";

    let confidence = Number(parsed?.confidence ?? 0);
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));

    // Demote low-confidence to "other" so a coin-flip doesn't cause mis-routing
    const finalIntent: InboundIntent = confidence < 0.6 ? "other" : intent;

    return {
      intent: finalIntent,
      confidence,
      reasoning: parsed?.reasoning?.trim() ?? "(no reasoning)",
      propertyHint: parsed?.propertyHint?.trim() || undefined,
      classifiedAt: new Date().toISOString(),
      model: MODELS.HAIKU,
    };
  } catch (err) {
    // Don't drop the email — let the caller fall back to safe defaults
    console.warn("[classify-inbound-email] classifier failed:", err);
    return {
      intent: "other",
      confidence: 0,
      reasoning: `Classifier error: ${err instanceof Error ? err.message : String(err)}`,
      classifiedAt: new Date().toISOString(),
      model: MODELS.HAIKU,
    };
  }
}

// Helper for poll-gmail: walk the Gmail message payload tree collecting all
// attachment filenames (any extension). Used to build the InboundEmailFeatures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function collectAttachmentFilenames(payload: any): string[] {
  const names: string[] = [];
  const walk = (p: any) => {
    if (!p) return;
    if (p.filename && typeof p.filename === "string") names.push(p.filename);
    if (Array.isArray(p.parts)) for (const c of p.parts) walk(c);
  };
  walk(payload);
  return names.filter(Boolean);
}
