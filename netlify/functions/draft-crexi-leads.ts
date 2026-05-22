/**
 * Netlify scheduled function — fires every 5 minutes and triggers the
 * CREXi hot-lead drafter at /api/cron/draft-crexi-leads.
 *
 * Schedule: every 5 minutes.
 *
 * Why separate from poll-gmail (runs every minute)?
 *   - Drafting is slower: each Sonnet call takes ~5-8s. Running 5 drafts
 *     per tick at 5-minute intervals means we flush ~36 backlog leads
 *     (e.g. from a day's CREXi report) within 36 minutes — fast enough
 *     for John to find them in "Do This Now" shortly after arrival.
 *   - Decoupling drafting from the import path keeps the 60s crexi-report
 *     route from timing out when a large daily report (30+ hot leads) lands.
 *
 * Once the backlog is clear, this function becomes a no-op (the route
 * returns immediately with drafted=0) until the next daily import.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const startedAt = new Date().toISOString();
  console.log(`[draft-crexi-leads] start ${startedAt}`);

  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("[draft-crexi-leads] CRON_SECRET not set in function env");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/api/cron/draft-crexi-leads`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    const text = await res.text();
    console.log(`[draft-crexi-leads] status=${res.status} body=${text.slice(0, 300)}`);
    return new Response(text, { status: res.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[draft-crexi-leads] fetch error:", message);
    return new Response(`error: ${message}`, { status: 500 });
  }
}

export const config: Config = {
  schedule: "*/5 * * * *",
};
