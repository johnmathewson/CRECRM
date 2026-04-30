/**
 * Thin wrapper over the Anthropic Messages API. Matches the raw-fetch
 * convention used elsewhere in the codebase (no SDK abstraction) but
 * factors out the repetitive headers + error handling.
 */

export const MODELS = {
  HAIKU: "claude-haiku-4-5-20251001",
  SONNET: "claude-sonnet-4-20250514",
} as const;

export type AnthropicModel = (typeof MODELS)[keyof typeof MODELS] | string;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | any[];
}

export interface AnthropicCallOptions {
  model: AnthropicModel;
  system?: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface AnthropicCallResult {
  text: string;
  usage?: { input_tokens: number; output_tokens: number };
  stopReason?: string;
  raw?: any;
}

export class AnthropicError extends Error {
  constructor(public status: number, message: string, public raw?: any) {
    super(message);
  }
}

export async function callAnthropic(opts: AnthropicCallOptions): Promise<AnthropicCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
    throw new AnthropicError(500, "ANTHROPIC_API_KEY not configured");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
      system: opts.system,
      messages: opts.messages,
    }),
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new AnthropicError(res.status, `Non-JSON response from Anthropic (status ${res.status})`);
  }

  if (!res.ok) {
    const msg = data?.error?.message || `Anthropic API error (status ${res.status})`;
    throw new AnthropicError(res.status, msg, data);
  }

  const text = data.content?.[0]?.type === "text" ? data.content[0].text : "";
  return {
    text,
    usage: data.usage,
    stopReason: data.stop_reason,
    raw: data,
  };
}

/**
 * Strip markdown code fences and parse the model's text as JSON. Returns
 * null on failure so callers can surface a clean error.
 */
export function parseJsonResponse<T = any>(text: string): T | null {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Sometimes the model leads with prose; try to grab the largest JSON object.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}
