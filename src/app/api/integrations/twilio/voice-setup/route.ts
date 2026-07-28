/**
 * GET /api/integrations/twilio/voice-setup
 *
 * One-time voice wiring for the business line. Session-authed; runs on
 * Netlify where the Twilio creds live, so no local env needed.
 *
 *   GET               → report the number's current voice config vs desired
 *   GET ?apply=true   → write voiceUrl + statusCallback onto the number
 *
 * Visit from a logged-in browser:
 *   https://stewardship-crm.netlify.app/api/integrations/twilio/voice-setup
 *
 * Refuses to apply from localhost (would register unreachable webhook
 * URLs); override the base with ?base=https://... if ever needed.
 */

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getTwilioConfig } from "@/lib/twilio";
import { createServerSupabase } from "@/lib/supabase/server";
import { forwardToNumber } from "@/lib/twilio-voice";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authSb = createServerSupabase();
  const { data: { user } } = await authSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { config, missing } = getTwilioConfig();
  if (missing.length > 0) {
    return NextResponse.json({ error: "Twilio not configured", missing }, { status: 500 });
  }
  if (!config.fromNumber) {
    return NextResponse.json({ error: "TWILIO_FROM_NUMBER not set" }, { status: 500 });
  }

  const base = req.nextUrl.searchParams.get("base") ?? req.nextUrl.origin;
  const apply = req.nextUrl.searchParams.get("apply") === "true";

  if (apply && base.includes("localhost")) {
    return NextResponse.json({
      error: "Refusing to register localhost webhook URLs. Run this from the deployed site, or pass ?base=https://stewardship-crm.netlify.app",
    }, { status: 400 });
  }

  try {
    const client = twilio(config.authUser, config.authToken, { accountSid: config.accountSid });
    const nums = await client.incomingPhoneNumbers.list({ phoneNumber: config.fromNumber, limit: 1 });
    if (nums.length === 0) {
      return NextResponse.json({
        error: `Number ${config.fromNumber} not found on this Twilio account`,
      }, { status: 404 });
    }
    const num = nums[0];

    const desired = {
      voiceUrl: `${base}/api/webhooks/twilio/voice`,
      voiceMethod: "POST",
      statusCallback: `${base}/api/webhooks/twilio/voice/status`,
      statusCallbackMethod: "POST",
    };
    const current = {
      voiceUrl: num.voiceUrl || null,
      voiceMethod: num.voiceMethod || null,
      statusCallback: num.statusCallback || null,
      statusCallbackMethod: num.statusCallbackMethod || null,
    };

    if (!apply) {
      return NextResponse.json({
        number: num.phoneNumber,
        forwardsTo: forwardToNumber(),
        current,
        desired,
        hint: "Add ?apply=true to write the desired config to Twilio.",
      });
    }

    const updated = await client.incomingPhoneNumbers(num.sid).update(desired);
    return NextResponse.json({
      applied: true,
      number: updated.phoneNumber,
      forwardsTo: forwardToNumber(),
      before: current,
      after: {
        voiceUrl: updated.voiceUrl,
        voiceMethod: updated.voiceMethod,
        statusCallback: updated.statusCallback,
        statusCallbackMethod: updated.statusCallbackMethod,
      },
      test: "Call the number from another phone: it should ring your cell ~20s, then drop to the voicemail greeting.",
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unknown Twilio error",
    }, { status: 502 });
  }
}
