/**
 * GET /api/integrations/twilio/status
 *
 * Reports whether Twilio is configured + a soft connection check. Used
 * by the Settings UI to show connection status without exposing creds.
 */

import { NextResponse } from "next/server";
import twilio from "twilio";
import { getTwilioConfig } from "@/lib/twilio";

export const dynamic = "force-dynamic";

export async function GET() {
  const { config, missing } = getTwilioConfig();

  if (missing.length > 0) {
    return NextResponse.json({
      connected: false,
      missing,
      hint: "Add these env vars in Netlify (Site settings → Environment variables) and redeploy.",
    });
  }

  // Soft validation: attempt to fetch the messaging service to confirm auth
  try {
    const client = twilio(config.authUser, config.authToken, { accountSid: config.accountSid });
    const svc = await client.messaging.v1.services(config.messagingServiceSid).fetch();
    return NextResponse.json({
      connected: true,
      accountSidSuffix: config.accountSid.slice(-4),
      messagingService: {
        sid: svc.sid,
        friendlyName: svc.friendlyName,
        useCase: svc.usecase ?? null,
      },
      fromNumber: config.fromNumber,
      testMode: config.testMode,
      testDestination: config.testMode ? config.testDestination : null,
    });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      error: err instanceof Error ? err.message : "Unknown Twilio error",
      hint: "Credentials are set but Twilio rejected them. Check the values match the Account.",
    });
  }
}
