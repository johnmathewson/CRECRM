/**
 * POST /api/leads/test
 *
 * Dev-only seeder: forwards a synthetic inbound to /api/leads/intake using
 * a small library of fixtures. Lets you exercise the full pipeline (qualify
 * → match → draft → events) without needing real Gmail/Twilio wired up.
 *
 * Usage:
 *   POST /api/leads/test                    -> picks a random fixture
 *   POST /api/leads/test  body: { fixture: "crexi_buyer" }   -> specific
 *   POST /api/leads/test  body: { custom: { ...intake payload... } }
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const FIXTURES = {
  crexi_buyer: {
    source: "email",
    sender_name: "Marcus Chen",
    sender_email: "marcus.chen@chenholdings.com",
    raw_subject: "Inquiry on 7880 Broadway, Merrillville",
    raw_body:
      "Hi John,\n\nSaw your CREXi listing for 7880 Broadway in Merrillville. We're a 1031 buyer with proceeds from a Texas industrial sale closing in 45 days. Looking at $3.5–4M range, NNN preferred. Would love to see the rent roll and last 24 months of operating history.\n\nQuick questions:\n- Is the anchor tenant on a long-term lease?\n- Any deferred capex we should know about?\n- Are you taking offers now or waiting?\n\nThanks,\nMarcus\nChen Holdings\n(312) 555-0142",
    raw_payload: { simulated: true, source_portal: "crexi" },
    source_message_id: `test-crexi-buyer-${Date.now()}`,
  },
  loopnet_tenant: {
    source: "email",
    sender_name: "Sarah Whitfield",
    sender_email: "swhitfield@northstarpt.com",
    raw_subject: "Northstar PT — looking for 4-6K SF in NWI",
    raw_body:
      "Hi,\n\nI'm with Northstar Physical Therapy. We're opening our 3rd Indiana location and looking at the 4,000–6,000 SF range. The Crown Point professional office space your firm has listed on LoopNet caught my eye.\n\nWe'd want a 7-year initial term, modified gross. Build-out budget is roughly $35/SF that we'd want amortized into rent or as a TI allowance.\n\nWho should I be talking to about availability and current rate?\n\nThanks,\nSarah",
    raw_payload: { simulated: true, source_portal: "loopnet" },
    source_message_id: `test-loopnet-tenant-${Date.now()}`,
  },
  cold_unmatched: {
    source: "email",
    sender_name: "Pat Reilly",
    sender_email: "pat.reilly@gmail.com",
    raw_subject: "Industrial property in NWI",
    raw_body:
      "John — I'm an investor poking around the NWI industrial market. Not a specific listing in mind yet. What kind of cap rates are you seeing on stabilized industrial 20–50K SF in Lake/Porter counties? Happy to chat if you have something off-market.\n\n— Pat",
    raw_payload: { simulated: true, source_portal: "direct" },
    source_message_id: `test-cold-unmatched-${Date.now()}`,
  },
  vendor_spam: {
    source: "email",
    sender_name: "Aakash Sharma",
    sender_email: "aakash@seoexpertusa.com",
    raw_subject: "Rank higher on Google — boost your website traffic",
    raw_body:
      "Hi John,\n\nWe found your website stewardshipcre.com and noticed it's missing from page 1 of Google for several high-value keywords. Our SEO services can guarantee first-page ranking within 90 days. We also offer link building, guest posts, and press release distribution.\n\nReply for a free audit of your site!\n\nBest,\nAakash\nSEO Expert USA\nseoexpertusa.com",
    raw_payload: { simulated: true },
    source_message_id: `test-vendor-spam-${Date.now()}`,
  },
  sms_inquiry: {
    source: "sms",
    sender_name: null,
    sender_email: null,
    sender_phone: "+13125550199",
    raw_subject: null,
    raw_body:
      "Hey saw your sign on the Westville industrial building. Still available? Looking for ~30k sf for a packaging operation. Need to be in by Q3.",
    raw_payload: { simulated: true, twilio_from: "+13125550199" },
    source_message_id: `test-sms-${Date.now()}`,
  },
  voicemail_callback: {
    source: "voice",
    sender_name: "Jim Petrov",
    sender_email: null,
    sender_phone: "+12195550172",
    raw_subject: "Voicemail from +1 (219) 555-0172",
    raw_body:
      "Hi John, this is Jim Petrov calling about your medical office listing in Joliet. I'm a chiropractor looking to relocate from a 2,500-square-foot space, want to be there by August. Can you give me a call back at this number? 219-555-0172. Thanks.",
    raw_payload: { simulated: true, twilio_recording_sid: "RErand", duration_sec: 32 },
    source_message_id: `test-voicemail-${Date.now()}`,
  },
};

export async function POST(req: NextRequest) {
  let body: { fixture?: keyof typeof FIXTURES; custom?: any } = {};
  try {
    body = await req.json();
  } catch {
    // empty body — fall through to random fixture
  }

  let payload: any;
  if (body.custom) {
    payload = { ...body.custom };
    if (!payload.source_message_id) payload.source_message_id = `test-custom-${Date.now()}`;
  } else {
    const key = body.fixture && FIXTURES[body.fixture]
      ? body.fixture
      : (Object.keys(FIXTURES) as (keyof typeof FIXTURES)[])[Math.floor(Math.random() * Object.keys(FIXTURES).length)];
    payload = FIXTURES[key];
  }

  // Forward to the real intake endpoint so we exercise the full pipeline.
  // Use the request's own origin so this works in dev + prod.
  const origin = req.nextUrl.origin;
  const intakeRes = await fetch(`${origin}/api/leads/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const intakeData = await intakeRes.json().catch(() => ({}));

  return NextResponse.json(
    {
      sent: payload,
      intake_status: intakeRes.status,
      intake_response: intakeData,
      available_fixtures: Object.keys(FIXTURES),
    },
    { status: intakeRes.ok ? 200 : intakeRes.status }
  );
}

export async function GET() {
  return NextResponse.json({
    available_fixtures: Object.keys(FIXTURES),
    usage: "POST /api/leads/test  with optional body { fixture: '<name>' } or { custom: {...intake payload...} }",
  });
}
