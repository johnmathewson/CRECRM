/**
 * Twilio client — thin typed wrapper for SMS send + inbound parsing.
 *
 * Auth: reads from env. Supports two patterns:
 *   1. Account SID + Auth Token (simplest)
 *   2. Account SID + API Key SID (SKxxx) + API Key Secret (more rotatable)
 *
 * Sending: always goes through the Messaging Service (MG...) so 10DLC
 * campaign rules apply. Direct-from-number sending is intentionally not
 * supported — it bypasses our A2P registration and risks blocking.
 *
 * Compliance:
 *   - Twilio's Messaging Service auto-injects STOP/HELP language on the
 *     first message and handles STOP opt-outs at the carrier level
 *   - We additionally detect STOP/HELP/CANCEL/UNSUBSCRIBE keywords on
 *     inbound and update our own DB state
 *
 * Test mode: when TWILIO_TEST_MODE=true, every outbound is rerouted to
 * TWILIO_TEST_DESTINATION with the original recipient embedded in the body.
 * Lets us walk through cadences end-to-end without spamming real owners.
 */

import twilio from "twilio";
import { validateRequest } from "twilio/lib/webhooks/webhooks";

function getEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

export interface TwilioConfig {
  accountSid: string;
  /** Either Auth Token OR API Key Secret */
  authToken: string;
  /** API Key SID (SKxxx) if using key-pair auth, else the same as accountSid */
  authUser: string;
  messagingServiceSid: string;
  fromNumber: string | null;
  testMode: boolean;
  testDestination: string | null;
}

export function getTwilioConfig(): { config: TwilioConfig; missing: string[] } {
  const accountSid = getEnv("TWILIO_ACCOUNT_SID");
  const authToken = getEnv("TWILIO_AUTH_TOKEN") ?? getEnv("TWILIO_API_KEY_SECRET");
  const apiKeySid = getEnv("TWILIO_API_KEY_SID");
  const messagingServiceSid = getEnv("TWILIO_MESSAGING_SERVICE_SID");
  const fromNumber = getEnv("TWILIO_FROM_NUMBER");
  const testMode = getEnv("TWILIO_TEST_MODE")?.toLowerCase() === "true";
  const testDestination = getEnv("TWILIO_TEST_DESTINATION");

  const missing: string[] = [];
  if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!authToken) missing.push("TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SECRET)");
  if (!messagingServiceSid) missing.push("TWILIO_MESSAGING_SERVICE_SID");
  if (testMode && !testDestination) missing.push("TWILIO_TEST_DESTINATION (required when TWILIO_TEST_MODE=true)");

  return {
    config: {
      accountSid: accountSid ?? "",
      authToken: authToken ?? "",
      authUser: apiKeySid ?? accountSid ?? "",
      messagingServiceSid: messagingServiceSid ?? "",
      fromNumber,
      testMode,
      testDestination,
    },
    missing,
  };
}

let _client: ReturnType<typeof twilio> | null = null;
function getClient(): { client: ReturnType<typeof twilio>; config: TwilioConfig } {
  const { config, missing } = getTwilioConfig();
  if (missing.length > 0) {
    throw new Error(`Twilio not configured. Missing env: ${missing.join(", ")}`);
  }
  if (!_client) {
    _client = twilio(config.authUser, config.authToken, { accountSid: config.accountSid });
  }
  return { client: _client, config };
}

// ── SMS send ────────────────────────────────────────────────────────────

export interface SendSmsInput {
  /** E.164 format, e.g. +13125550100 */
  to: string;
  /** Message body — keep under 160 chars to fit one segment. */
  body: string;
}

export interface SendSmsResult {
  messageSid: string;
  status: string;
  to: string;
  /** True when test-mode rerouted away from the intended recipient */
  rerouted: boolean;
}

/**
 * Send an SMS via the Messaging Service. Returns the Twilio Message SID
 * which can be stored on lane_touches.metadata for later matching.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const { client, config } = getClient();

  let actualTo = input.to;
  let actualBody = input.body;
  let rerouted = false;

  if (config.testMode && config.testDestination) {
    rerouted = true;
    actualTo = config.testDestination;
    actualBody = `[TEST → ${input.to}] ${input.body}`;
  }

  const msg = await client.messages.create({
    to: actualTo,
    body: actualBody,
    messagingServiceSid: config.messagingServiceSid,
  });

  return {
    messageSid: msg.sid,
    status: msg.status,
    to: actualTo,
    rerouted,
  };
}

// ── Webhook signature verification ──────────────────────────────────────

/**
 * Verify that an inbound webhook request actually came from Twilio.
 * Prevents spoofed inbound messages from anyone with the URL.
 */
export function verifyTwilioSignature(opts: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  const { config, missing } = getTwilioConfig();
  if (missing.includes("TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SECRET)")) return false;
  if (!opts.signature) return false;
  // Note: Twilio's RequestValidator uses the Auth Token (not API Key Secret)
  // for signature validation. If only API Key Secret is configured, signature
  // verification won't work — caller must accept unsigned in that case.
  const authToken = getEnv("TWILIO_AUTH_TOKEN");
  if (!authToken) return false;
  return validateRequest(authToken, opts.signature, opts.url, opts.params);
}

// ── Stop/help keyword detection ────────────────────────────────────────

const STOP_KEYWORDS = new Set([
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit",
]);
const HELP_KEYWORDS = new Set(["help", "info"]);
const START_KEYWORDS = new Set(["start", "yes", "unstop"]);

export type SmsIntent = "stop" | "help" | "start" | "reply";

export function classifyInboundSms(body: string): SmsIntent {
  const trimmed = body.trim().toLowerCase();
  if (STOP_KEYWORDS.has(trimmed)) return "stop";
  if (HELP_KEYWORDS.has(trimmed)) return "help";
  if (START_KEYWORDS.has(trimmed)) return "start";
  return "reply";
}

// ── E.164 normalization ─────────────────────────────────────────────────

/** Normalize a US phone number to E.164. Returns null if input is unusable. */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return null;
}
