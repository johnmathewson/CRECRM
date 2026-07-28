/**
 * Shared plumbing for Twilio webhook routes (voice family; the SMS route
 * predates this module and keeps its own inline copy).
 *
 * - parseTwilioWebhook: form-decode + signature verification in one call.
 *   Honors TWILIO_SKIP_WEBHOOK_SIGNATURE=true (setup-phase escape hatch,
 *   same contract as the SMS webhook).
 * - twiml: 200 TwiML response. Twilio must ALWAYS get a 200 — even on
 *   dropped/invalid requests — or it retries and re-fires the webhook.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyTwilioSignature } from "@/lib/twilio";

export async function parseTwilioWebhook(
  req: NextRequest
): Promise<{ params: Record<string, string>; valid: boolean }> {
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((v, k) => {
    params[k] = String(v);
  });

  const skipSig = process.env.TWILIO_SKIP_WEBHOOK_SIGNATURE === "true";
  const valid =
    skipSig ||
    verifyTwilioSignature({
      signature: req.headers.get("x-twilio-signature"),
      url: `${req.nextUrl.origin}${req.nextUrl.pathname}`,
      params,
    });
  return { params, valid };
}

export function twiml(inner = ""): NextResponse {
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
    { status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" } }
  );
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
