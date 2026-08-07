/**
 * Netlify scheduled function — Property Enrichment Agent.
 *
 * Hourly at :10 (raised from daily 2026-08-07 with John's sign-off —
 * runs take 3-9s against the 60s cap, so frequency is the safe lever;
 * 40/batch x 24 runs ≈ 960 properties/day → full 15k sweep in ~16 days,
 * then steady-state re-scans as 14-day cooldowns lapse). Same trigger
 * pattern as poll-gmail: the function just POSTs the API route with the
 * cron secret; all real work (and the run ledger) lives there.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[property-enricher] CRON_SECRET not set");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  try {
    const res = await fetch(`${baseUrl}/api/agents/property-enricher/run`, {
      method: "POST",
      headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
      body: JSON.stringify({ batchSize: 40 }),
    });
    const text = await res.text();
    console.log(`[property-enricher] status=${res.status} body=${text.slice(0, 500)}`);
    return new Response(text, { status: res.status });
  } catch (err) {
    console.error("[property-enricher] fetch error:", err);
    return new Response(`error: ${err instanceof Error ? err.message : err}`, { status: 500 });
  }
}

export const config: Config = {
  schedule: "10 * * * *",
};
