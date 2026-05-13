/**
 * Reply classifier — reads an inbound email/SMS reply to one of our
 * outbound touches and returns a structured read on what the recipient
 * is actually saying, plus a draft response the broker can edit-and-send.
 *
 * Six intents covered:
 *   - interested:    they want to engage / want more info / want to talk
 *   - question:      they have a specific question or condition before deciding
 *   - declined:      not interested, but politely. Tickler material.
 *   - hostile:       angry, complaining, or aggressive. Handle with care.
 *   - unsubscribe:   STOP / remove me / stop emailing. Honor immediately.
 *   - out_of_office: auto-responder. Re-touch later.
 *   - unclear:       can't tell. Let the human read.
 *
 * The draft response is grounded in the inbound's actual content + the
 * parent outbound context. For unsubscribe / out_of_office it's empty —
 * those don't need a reply, just state changes.
 */

import { callAnthropic, parseJsonResponse, MODELS } from "@/lib/anthropic";

export type ReplyIntent =
  | "interested"
  | "question"
  | "declined"
  | "hostile"
  | "unsubscribe"
  | "out_of_office"
  | "unclear";

export interface ReplyClassification {
  intent: ReplyIntent;
  /** 0-1, the model's confidence. Below 0.6 we treat as 'unclear' for safety. */
  confidence: number;
  /** One-sentence read of what the recipient said. Shown in the inbox row. */
  summary: string;
  /** Draft response the broker can edit-and-send. Empty for unsubscribe/OOO. */
  suggestedReply: string;
  /** Optional next-action hint for the broker. */
  nextAction?: string;
  /** Model used + when classified, for audit */
  classifiedAt: string;
  model: string;
}

export interface ClassifyReplyInput {
  /** Body of the inbound reply */
  inboundBody: string;
  /** Subject line if present (email) */
  inboundSubject?: string | null;
  /** What we sent that prompted this reply */
  parentSubject?: string | null;
  parentBody?: string | null;
  /** Optional property + recipient context */
  property?: {
    name?: string | null;
    address?: string | null;
    assetType?: string | null;
  };
  recipient?: {
    name?: string | null;
    company?: string | null;
  };
  /** What the broker's name is, so the draft signs off correctly */
  senderName?: string;
}

const SYSTEM = `You read commercial real estate inbound replies and classify the sender's intent so a busy broker can triage their inbox in seconds.

INTENTS (pick exactly one):
  - interested:    they want to engage further — schedule a call, send more info, talk numbers, tour the property, etc.
  - question:      they have a specific question or precondition. They're not yet committed but they're engaged.
  - declined:      politely not interested. May say "not right now", "we passed", "thanks but no". Save them for future cycles.
  - hostile:       angry, complaining, sarcastic, threatening, or aggressive. Handle with care.
  - unsubscribe:   STOP, remove me, take me off your list, never email me. Hard opt-out signal.
  - out_of_office: auto-reply, vacation, "out until Monday", maternity, sabbatical. Reschedule the touch.
  - unclear:       ambiguous, very short, off-topic. Punt to the human.

WHEN UNSURE: pick 'unclear' rather than guessing. Better to surface to the human than mis-classify.

DRAFT RESPONSE GUIDANCE:
  - For 'interested' and 'question': write a short response (3-4 sentences) that directly addresses what they said. Sign with the broker's name. No fluff, no sales clichés. Be specific to what they asked.
  - For 'declined': write a brief, gracious response (2 sentences) thanking them and leaving the door open for future cycles.
  - For 'hostile': write nothing in suggestedReply — set it to an empty string. The broker handles these personally.
  - For 'unsubscribe' or 'out_of_office': empty suggestedReply. State change only.
  - For 'unclear': empty suggestedReply. The broker reads it.

TONE: Direct, Midwest-broker, plain English. Never invent facts the recipient didn't mention. Never quote dollar amounts or property details that aren't in the parent message context.

OUTPUT FORMAT — return ONLY a JSON object with these fields:
{
  "intent": "one of the 7 enum values above",
  "confidence": 0.0-1.0 (0.6+ = confident, below = treat as unclear),
  "summary": "one sentence on what they said",
  "suggestedReply": "draft response text, or empty string",
  "nextAction": "one short phrase for what the broker should do next, or empty"
}

Do not include any text outside the JSON object. Do not wrap in markdown code fences.`;

export async function classifyReply(input: ClassifyReplyInput): Promise<ReplyClassification> {
  const ctxLines: string[] = [];
  if (input.property?.name) ctxLines.push(`Property: ${input.property.name}`);
  if (input.property?.address) ctxLines.push(`Address: ${input.property.address}`);
  if (input.property?.assetType) ctxLines.push(`Asset class: ${input.property.assetType}`);
  if (input.recipient?.name) ctxLines.push(`Recipient: ${input.recipient.name}`);
  if (input.recipient?.company) ctxLines.push(`Company: ${input.recipient.company}`);

  const parentText = input.parentBody
    ? `WHAT WE SENT THEM (the message they're replying to):
Subject: ${input.parentSubject ?? "(no subject)"}
${input.parentBody.slice(0, 2000)}
`
    : "(No parent message context — they may have initiated.)";

  const userText = `Classify this reply.

CONTEXT:
${ctxLines.length > 0 ? ctxLines.join("\n") : "(no property/recipient context provided)"}

${parentText}

THEIR INBOUND REPLY:
${input.inboundSubject ? `Subject: ${input.inboundSubject}\n` : ""}${input.inboundBody.slice(0, 3000)}

The broker's name is "${input.senderName ?? "John Mathewson"}" — use this if you write a draft.

Now classify and draft (if applicable). Return JSON only.`;

  let result;
  try {
    result = await callAnthropic({
      model: MODELS.SONNET,
      system: SYSTEM,
      messages: [{ role: "user", content: userText }],
      maxTokens: 1024,
      temperature: 0.3, // low — classification benefits from determinism
    });
  } catch (err) {
    // If Claude fails, return an "unclear" so the broker still gets the
    // raw reply in the inbox without us claiming a wrong intent.
    return {
      intent: "unclear",
      confidence: 0,
      summary: `(Classification failed — ${err instanceof Error ? err.message : err})`,
      suggestedReply: "",
      classifiedAt: new Date().toISOString(),
      model: MODELS.SONNET,
    };
  }

  const parsed = parseJsonResponse<{
    intent?: string;
    confidence?: number;
    summary?: string;
    suggestedReply?: string;
    nextAction?: string;
  }>(result.text);

  // Validate intent
  const validIntents: ReplyIntent[] = [
    "interested", "question", "declined", "hostile",
    "unsubscribe", "out_of_office", "unclear",
  ];
  const intent: ReplyIntent =
    parsed?.intent && validIntents.includes(parsed.intent as ReplyIntent)
      ? (parsed.intent as ReplyIntent)
      : "unclear";

  let confidence = Number(parsed?.confidence ?? 0);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(1, confidence));

  // Demote low-confidence to 'unclear' so the broker doesn't trust a coin-flip
  const finalIntent: ReplyIntent = confidence < 0.6 ? "unclear" : intent;

  return {
    intent: finalIntent,
    confidence,
    summary: parsed?.summary?.trim() ?? "(no summary)",
    suggestedReply: parsed?.suggestedReply?.trim() ?? "",
    nextAction: parsed?.nextAction?.trim() || undefined,
    classifiedAt: new Date().toISOString(),
    model: MODELS.SONNET,
  };
}
