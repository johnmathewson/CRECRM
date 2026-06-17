/**
 * Netlify scheduled function — Mon–Sat morning Steward brief.
 *
 * Schedule: 11:00 UTC every Mon–Sat.
 *   - That's 6:00 AM CDT (mid-Mar to early-Nov, John's local time)
 *   - And  5:00 AM CST (early-Nov to mid-Mar)
 *   - Earlier in winter is acceptable — CREXi delivery is at 5am CT
 *     anyway, so the brief still picks up the freshest leads.
 *
 * What it does: POSTs to the steward-run-background function. The
 * background function runs the agent (30-90s of Sonnet + tool calls),
 * writes to daily_briefings, and emails John. This wrapper just kicks
 * the cron and exits quickly.
 *
 * Why not call runStewardBrief() directly here: scheduled functions
 * have stricter sync-timeouts than background functions. The kick +
 * background-function split keeps every cron tick well under any
 * Netlify time limit.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const startedAt = new Date().toISOString();
  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const bgUrl = `${baseUrl}/.netlify/functions/steward-run-background`;

  console.log(`[steward-daily] ${startedAt} kicking ${bgUrl}`);

  try {
    const res = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefType: "daily" }),
    });
    const status = res.status;
    const text = await res.text().catch(() => "");
    console.log(`[steward-daily] kick status=${status} body=${text.slice(0, 200)}`);
    return new Response(`kicked steward-run-background, status=${status}`, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[steward-daily] kick failed:", err);
    return new Response(`kick failed: ${msg}`, { status: 500 });
  }
}

export const config: Config = {
  // Mon–Sat at 11:00 UTC (= 6am CDT summer / 5am CST winter).
  // Cron expression: minute hour day-of-month month day-of-week
  // day-of-week: 1=Mon … 6=Sat (Sunday is 0 — excluded)
  schedule: "0 11 * * 1-6",
};
