/**
 * GET /api/integrations/twilio/sms-setup
 *
 * Companion to voice-setup for the inbound SMS webhook. Shows where Twilio
 * currently posts inbound texts (Messaging Service inbound URL + the number's
 * own SMS URL) and, with ?apply=true, re-points them at THIS host:
 *
 *   https://<this origin>/api/webhooks/twilio/sms
 *
 * Built for the move from stewardship-crm.netlify.app to
 * crm.stewardshipcre.com: open it signed in on the new host and apply. Only
 * the origin changes; paths and methods stay. Refuses to apply from
 * localhost. Session-authed; runs on Netlify where the Twilio creds live.
 */

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { getTwilioConfig } from "@/lib/twilio";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function page(title: string, bodyHtml: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { background:#0D0D0D; color:#F5F1E8; font-family:-apple-system,system-ui,sans-serif; margin:0; padding:24px; font-size:17px; line-height:1.6; }
  .card { background:#1A1A1A; border:1px solid #282828; border-radius:14px; padding:22px; max-width:560px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 14px; }
  .ok { color:#4ECDC4; font-weight:600; } .warn { color:#E8A87C; font-weight:600; } .muted { color:#A8A29A; font-size:15px; }
  .btn { display:block; text-align:center; background:#4ECDC4; color:#0D0D0D; font-weight:700; text-decoration:none; padding:14px; border-radius:10px; margin:20px 0 8px; font-size:17px; }
  code { font-size:14px; word-break:break-all; }
  table { border-collapse:collapse; width:100%; font-size:14px; } td { padding:6px 0; vertical-align:top; border-top:1px solid #282828; } td:first-child { color:#A8A29A; width:38%; }
</style></head><body><div class="card">${bodyHtml}</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function GET(req: NextRequest) {
  const authSb = createServerSupabase();
  const { data: { user } } = await authSb.auth.getUser();
  if (!user) return page("Sign in required", `<h1>Sign in first</h1><p>Open <a href="/login?next=/api/integrations/twilio/sms-setup" style="color:#4ECDC4">the CRM login</a>, sign in, then come back.</p>`);

  const { config, missing } = getTwilioConfig();
  if (missing.length > 0) return page("Twilio not configured", `<h1>Twilio isn't fully configured</h1><p class="warn">Missing: ${esc(missing.join(", "))}</p>`);

  const apply = req.nextUrl.searchParams.get("apply") === "true";
  const base = req.nextUrl.searchParams.get("base") ?? req.nextUrl.origin;
  if (apply && base.includes("localhost")) return page("Not from localhost", `<h1>Open this on the deployed site</h1><p>Applying from a dev server would point Twilio at URLs it can't reach.</p>`);
  const target = `${base}/api/webhooks/twilio/sms`;

  const client = twilio(config.authUser, config.authToken, { accountSid: config.accountSid });
  const svcSid = config.messagingServiceSid;
  const svc = svcSid ? await client.messaging.v1.services(svcSid).fetch() : null;
  const nums = config.fromNumber ? await client.incomingPhoneNumbers.list({ phoneNumber: config.fromNumber, limit: 1 }) : [];
  const num = nums[0] ?? null;

  const rows = (s: typeof svc, n: typeof num | null) => `<table>
    <tr><td>Messaging Service</td><td>${esc(s?.friendlyName ?? "—")} <span class="muted">${esc(svcSid ?? "")}</span></td></tr>
    <tr><td>Service inbound URL</td><td><code>${esc(s?.inboundRequestUrl ?? "—")}</code> ${s?.inboundMethod ? `<span class="muted">${esc(s.inboundMethod)}</span>` : ""}</td></tr>
    <tr><td>Service fallback URL</td><td><code>${esc(s?.fallbackUrl ?? "—")}</code></td></tr>
    <tr><td>Service status callback</td><td><code>${esc(s?.statusCallback ?? "—")}</code></td></tr>
    <tr><td>Uses number's own webhook</td><td>${s?.useInboundWebhookOnNumber ? "yes" : "no"}</td></tr>
    <tr><td>Number ${esc(config.fromNumber ?? "")} SMS URL</td><td><code>${esc(n?.smsUrl || "—")}</code> ${n?.smsMethod ? `<span class="muted">${esc(n.smsMethod)}</span>` : ""}</td></tr>
  </table>`;

  if (!apply) {
    const already = svc?.inboundRequestUrl === target;
    return page("Twilio SMS webhook", `<h1>Inbound SMS webhook</h1>
      ${rows(svc, num)}
      <p style="margin-top:14px">This host would receive texts at:<br><code>${esc(target)}</code></p>
      ${already ? `<p class="ok">Already pointing here. Nothing to do.</p>` : `<a class="btn" href="?apply=true">Point Twilio at this host</a><p class="muted">Only the host changes; the path and POST method stay. The old host keeps working for anything still aimed at it.</p>`}`);
  }

  const changes: string[] = [];
  const rehost = (u: string | null | undefined) => {
    if (!u) return u ?? undefined;
    try { const x = new URL(u); return `${base}${x.pathname}${x.search}`; } catch { return u; }
  };
  if (svc) {
    const upd: Record<string, string> = { inboundRequestUrl: target, inboundMethod: "POST" };
    if (svc.fallbackUrl) upd.fallbackUrl = rehost(svc.fallbackUrl)!;
    if (svc.statusCallback) upd.statusCallback = rehost(svc.statusCallback)!;
    await client.messaging.v1.services(svc.sid).update(upd);
    changes.push(`Messaging Service inbound URL → ${target}`);
    if (upd.fallbackUrl) changes.push(`Messaging Service fallback URL → ${upd.fallbackUrl}`);
    if (upd.statusCallback) changes.push(`Messaging Service status callback → ${upd.statusCallback}`);
  }
  if (num && num.smsUrl && !num.smsUrl.startsWith(base)) {
    await client.incomingPhoneNumbers(num.sid).update({ smsUrl: rehost(num.smsUrl), smsMethod: "POST" });
    changes.push(`Number SMS URL → ${rehost(num.smsUrl)}`);
  }
  const after = svcSid ? await client.messaging.v1.services(svcSid).fetch() : null;
  const numAfter = num ? await client.incomingPhoneNumbers(num.sid).fetch() : null;
  return page("Twilio SMS webhook updated", `<h1 class="ok">Updated</h1>
    <ul>${changes.map((c) => `<li>${esc(c)}</li>`).join("") || "<li>Nothing needed changing.</li>"}</ul>
    ${rows(after, numAfter)}
    <p class="muted" style="margin-top:14px">Test: text the business line from your cell. The reply notification should arrive as before.</p>`);
}
