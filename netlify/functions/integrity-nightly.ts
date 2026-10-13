/**
 * Netlify scheduled function — nightly record-integrity check.
 *
 * 06:00 CT daily (11:00 UTC). POSTs /api/integrity with the cron secret;
 * the route runs integrity_scorecard(), writes a ledger row, and texts John
 * only when a count is non-zero or an alarm fired in the last 24 hours.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[integrity-nightly] CRON_SECRET not set");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  try {
    const res = await fetch(`${baseUrl}/api/integrity`, {
      method: "POST",
      headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
    });
    const text = await res.text();
    console.log(`[integrity-nightly] status=${res.status} body=${text.slice(0, 500)}`);
    return new Response(text, { status: res.status });
  } catch (err) {
    console.error("[integrity-nightly] fetch error:", err);
    return new Response(`error: ${err instanceof Error ? err.message : err}`, { status: 500 });
  }
}

export const config: Config = {
  schedule: "0 11 * * *",
};
