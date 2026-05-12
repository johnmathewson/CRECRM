/**
 * GET /api/integrations/twilio/message/[sid]
 *
 * Diagnostic — fetch the current state of a message by SID. Shows the
 * actual error code + message from Twilio when delivery has stalled past
 * 'accepted'. Used to debug why a test SMS didn't arrive.
 */

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getTwilioConfig } from "@/lib/twilio";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { sid: string } }) {
  const { config, missing } = getTwilioConfig();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Twilio not configured. Missing: ${missing.join(", ")}` },
      { status: 412 }
    );
  }

  try {
    const client = twilio(config.authUser, config.authToken, { accountSid: config.accountSid });
    const msg = await client.messages(params.sid).fetch();
    return NextResponse.json({
      sid: msg.sid,
      status: msg.status,
      errorCode: msg.errorCode,
      errorMessage: msg.errorMessage,
      direction: msg.direction,
      from: msg.from,
      to: msg.to,
      body: msg.body,
      messagingServiceSid: msg.messagingServiceSid,
      numSegments: msg.numSegments,
      price: msg.price,
      priceUnit: msg.priceUnit,
      dateCreated: msg.dateCreated,
      dateSent: msg.dateSent,
      dateUpdated: msg.dateUpdated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Fetch failed" },
      { status: 502 }
    );
  }
}
