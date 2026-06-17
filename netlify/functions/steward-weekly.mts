/**
 * Netlify scheduled function — Sunday afternoon week-ahead brief.
 *
 * Schedule: 21:00 UTC every Sunday.
 *   - That's 4:00 PM CDT (summer)
 *   - And  3:00 PM CST (winter)
 *
 * What it does: same as steward-daily, but kicks the background
 * function with briefType="weekly" so Steward produces the Sunday
 * forward-looking + retrospective brief per the playbook.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const startedAt = new Date().toISOString();
  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const bgUrl = `${baseUrl}/.netlify/functions/steward-run-background`;

  console.log(`[steward-weekly] ${startedAt} kicking ${bgUrl}`);

  try {
    const res = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefType: "weekly" }),
    });
    const status = res.status;
    const text = await res.text().catch(() => "");
    console.log(`[steward-weekly] kick status=${status} body=${text.slice(0, 200)}`);
    return new Response(`kicked steward-run-background (weekly), status=${status}`, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[steward-weekly] kick failed:", err);
    return new Response(`kick failed: ${msg}`, { status: 500 });
  }
}

export const config: Config = {
  // Sundays at 21:00 UTC (= 4pm CDT summer / 3pm CST winter).
  schedule: "0 21 * * 0",
};
