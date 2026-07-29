/**
 * GET /api/integrations/twilio/voice-setup
 *
 * One-time voice wiring for the business line, as a human-readable page
 * (John activates this from his phone — no JSON squinting). Session-authed;
 * runs on Netlify where the Twilio creds live.
 *
 *   GET             → plain-English status + an Activate button
 *   GET ?apply=true → writes voiceUrl + statusCallback onto the number,
 *                     then shows what to test
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

function page(title: string, bodyHtml: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { background:#0D0D0D; color:#F5F1E8; font-family:-apple-system,system-ui,sans-serif;
         margin:0; padding:24px; font-size:17px; line-height:1.6; }
  .card { background:#1A1A1A; border:1px solid #282828; border-radius:14px;
          padding:22px; max-width:520px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 14px; }
  .ok { color:#4ECDC4; font-weight:600; }
  .warn { color:#E8A87C; font-weight:600; }
  .muted { color:#A8A29A; font-size:15px; }
  .btn { display:block; text-align:center; background:#4ECDC4; color:#0D0D0D;
         font-weight:700; text-decoration:none; padding:14px; border-radius:10px;
         margin:20px 0 8px; font-size:17px; }
  .num { font-variant-numeric:tabular-nums; white-space:nowrap; }
  ol { padding-left:20px; } li { margin-bottom:8px; }
</style></head><body><div class="card">${bodyHtml}</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const authSb = createServerSupabase();
  const { data: { user } } = await authSb.auth.getUser();
  if (!user) {
    return page("Sign in required", `<h1>Sign in first</h1>
      <p>Open <a href="/login" style="color:#4ECDC4">the CRM login</a>, sign in, then come back to this page.</p>`);
  }

  const { config, missing } = getTwilioConfig();
  if (missing.length > 0 || !config.fromNumber) {
    return page("Twilio not configured", `<h1>Twilio isn't fully configured</h1>
      <p class="warn">Missing settings: ${[...missing, ...(config.fromNumber ? [] : ["TWILIO_FROM_NUMBER"])].join(", ")}</p>
      <p class="muted">These live in Netlify → Site settings → Environment variables. After adding them, redeploy the site.</p>`);
  }

  const base = req.nextUrl.searchParams.get("base") ?? req.nextUrl.origin;
  const apply = req.nextUrl.searchParams.get("apply") === "true";

  if (apply && base.includes("localhost")) {
    return page("Wrong environment", `<h1>Run this from the live site</h1>
      <p>This page was opened from a local dev server, so activating here would point the phone number at URLs Twilio can't reach.</p>
      <p>Open it on the deployed site instead: <span class="num">stewardship-crm.netlify.app</span></p>`);
  }

  try {
    const client = twilio(config.authUser, config.authToken, { accountSid: config.accountSid });
    const nums = await client.incomingPhoneNumbers.list({ phoneNumber: config.fromNumber, limit: 1 });
    if (nums.length === 0) {
      return page("Number not found", `<h1>Number not found</h1>
        <p class="warn">Twilio says <span class="num">${config.fromNumber}</span> isn't on this account.</p>
        <p class="muted">Double-check TWILIO_FROM_NUMBER and TWILIO_ACCOUNT_SID in Netlify.</p>`);
    }
    const num = nums[0];

    const desired = {
      voiceUrl: `${base}/api/webhooks/twilio/voice`,
      voiceMethod: "POST",
      statusCallback: `${base}/api/webhooks/twilio/voice/status`,
      statusCallbackMethod: "POST",
    };
    const alreadyActive =
      num.voiceUrl === desired.voiceUrl && num.statusCallback === desired.statusCallback;
    const testSteps = `<p><b>Test it:</b></p><ol>
      <li>Call <span class="num">${num.phoneNumber}</span> from another phone.</li>
      <li>You'll hear "this call may be recorded", then your cell (<span class="num">${forwardToNumber()}</span>) rings for ~20 seconds.</li>
      <li>Don't answer — the caller gets your voicemail greeting. Leave a short message.</li>
      <li>Within a couple of minutes you should get a text with a link to the lead, and the transcript appears in the CRM.</li>
    </ol>`;

    if (apply) {
      await client.incomingPhoneNumbers(num.sid).update(desired);
      return page("Voice activated", `<h1><span class="ok">✓ Voice is live</span></h1>
        <p>Calls to <span class="num">${num.phoneNumber}</span> now forward to your cell, get recorded, and missed calls go to voicemail with transcription.</p>
        ${testSteps}`);
    }

    if (alreadyActive) {
      return page("Voice status", `<h1><span class="ok">✓ Voice is already set up</span></h1>
        <p>Calls to <span class="num">${num.phoneNumber}</span> forward to <span class="num">${forwardToNumber()}</span>, with voicemail + transcription on missed calls.</p>
        <p class="muted">Nothing to do here.</p>${testSteps}`);
    }

    return page("Activate voice", `<h1><span class="warn">Voice is not activated yet</span></h1>
      <p>Your business line <span class="num">${num.phoneNumber}</span> ${num.voiceUrl ? "is pointing at an old setup" : "doesn't answer calls yet"}.</p>
      <p>One tap fixes it. Calls will then:</p>
      <ol>
        <li>Forward to your cell (<span class="num">${forwardToNumber()}</span>)</li>
        <li>Go to voicemail with transcription if you miss them</li>
        <li>Text you a link to the lead</li>
      </ol>
      <a class="btn" href="?apply=true">Activate voice now</a>
      <p class="muted">This writes the settings onto the Twilio number. Safe to run again anytime.</p>`);
  } catch (err) {
    return page("Twilio error", `<h1 class="warn">Twilio returned an error</h1>
      <p class="num" style="white-space:normal">${err instanceof Error ? err.message : "Unknown error"}</p>
      <p class="muted">Screenshot this and send it to Claude.</p>`);
  }
}
