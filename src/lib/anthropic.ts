/**
 * Thin wrapper over the Anthropic Messages API. Matches the raw-fetch
 * convention used elsewhere in the codebase (no SDK abstraction) but
 * factors out the repetitive headers + error handling.
 */

/**
 * Model IDs use Anthropic's **alias** form (no date suffix). Aliases
 * always reroute to the current snapshot of their family, so a snapshot
 * retirement doesn't break us — we just keep getting the next build of
 * the same family.
 *
 * Tier semantics matter more than the family name. Call sites should
 * import via these constants rather than hardcoding "claude-..." inline,
 * so future family transitions (Claude 5, etc.) are a one-file change.
 *
 * The `FALLBACK_CHAIN` below is consulted when the API returns
 * `model_not_found` (the deprecation/retirement error) so a single
 * outage doesn't take the whole app down — we drop one tier and retry.
 */
export const MODELS = {
  HAIKU: "claude-haiku-4-5",
  SONNET: "claude-sonnet-4-6",
  OPUS: "claude-opus-4-8",
} as const;

// When an alias is unexpectedly unavailable, fall through to the next
// id. Order: try the requested model, then any tiers below it. Logged
// at WARN level so a deprecation shows up in production logs the first
// time the new fallback fires.
const FALLBACK_CHAIN: Record<string, string[]> = {
  [MODELS.OPUS]: [MODELS.SONNET, MODELS.HAIKU],
  [MODELS.SONNET]: [MODELS.HAIKU],
  [MODELS.HAIKU]: [],
};

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

  // Try the requested model, then walk the fallback chain on
  // `model_not_found` (Anthropic's deprecation/retirement error). Other
  // errors (auth, rate limit, content) are NOT retried — those are
  // not solved by trying a different model.
  const tried: Array<{ model: string; status: number; message: string }> = [];
  const candidates = [opts.model, ...(FALLBACK_CHAIN[opts.model] ?? [])];

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
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

    if (res.ok) {
      if (i > 0) {
        // Falling back is a signal that the requested model is gone
        // or unavailable — log it so a deprecation shows up the first
        // time it happens, not the tenth.
        console.warn(`[anthropic] requested model "${opts.model}" failed; succeeded on fallback "${model}". Tried: ${JSON.stringify(tried)}`);
      }
      const text = data.content?.[0]?.type === "text" ? data.content[0].text : "";
      return { text, usage: data.usage, stopReason: data.stop_reason, raw: data };
    }

    const msg = data?.error?.message || `Anthropic API error (status ${res.status})`;
    const errType = data?.error?.type as string | undefined;
    tried.push({ model, status: res.status, message: msg });

    // Only retry when the model is the problem. `not_found_error` covers
    // model_not_found / deprecated_model. 404s with a different error
    // type bail immediately. All non-404s bail immediately.
    const isModelMissing = res.status === 404 && (errType === "not_found_error" || /model/i.test(msg));
    if (!isModelMissing) {
      throw new AnthropicError(res.status, msg, data);
    }
  }

  throw new AnthropicError(404, `All models in fallback chain unavailable: ${JSON.stringify(tried)}`, { tried });
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
