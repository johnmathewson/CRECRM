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

/**
 * The origin the caller actually used. On Netlify `req.nextUrl.origin` is the
 * deploy's internal name (main--stewardship-crm.netlify.app), not the public
 * host, so Twilio's signature (computed over the URL it called) and the
 * deeplinks we text back must be built from the forwarded host instead.
 */
export function requestOrigin(req: NextRequest): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  if (!host) return req.nextUrl.origin;
  const proto = (req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  return `${proto}://${host}`;
}

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
      url: `${requestOrigin(req)}${req.nextUrl.pathname}`,
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
