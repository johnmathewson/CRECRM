/**
 * POST /api/integrations/twilio/test-send
 *
 * Fires a single SMS using the real send path (sendSms()) — same code
 * the cadence runner uses. Lets the user confirm the entire pipeline
 * works end-to-end (env → SDK → Twilio → carrier → phone) before
 * enabling autopilot.
 *
 * Defaults to the configured TWILIO_TEST_DESTINATION. Caller can
 * override with `to` + `body` fields. When test mode is active, sends
 * go to TWILIO_TEST_DESTINATION regardless of `to`.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendSms, getTwilioConfig, toE164 } from "@/lib/twilio";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { to?: string; body?: string } = {};
  try {
    if (req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0) {
      body = await req.json();
    }
  } catch {
    // empty body is fine
  }

  const { config, missing } = getTwilioConfig();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Twilio not configured. Missing: ${missing.join(", ")}` },
      { status: 412 }
    );
  }

  // Resolve target — explicit override wins, else default to test destination
  const to = toE164(body.to ?? config.testDestination ?? null);
  if (!to) {
    return NextResponse.json(
      { error: "No destination phone. Set TWILIO_TEST_DESTINATION env var or pass `to` in the body." },
      { status: 400 }
    );
  }

  const message =
    body.body ??
    `Test from Stewardship CRE OS at ${new Date().toLocaleTimeString()}. Reply STOP to opt out.`;

  try {
    const result = await sendSms({ to, body: message });
    return NextResponse.json({
      ok: true,
      message_sid: result.messageSid,
      status: result.status,
      sent_to: result.to,
      rerouted_by_test_mode: result.rerouted,
      original_target: body.to ?? config.testDestination,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 502 }
    );
  }
}
