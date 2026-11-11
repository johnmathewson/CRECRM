/**
 * Netlify scheduled function — nightly deal check-in at 8:45 PM Central.
 *
 * Netlify cron runs in UTC, and 8:45 PM in Chicago is 01:45 UTC during
 * daylight time and 02:45 UTC during standard time. So this fires at both
 * and only kicks the job when it really is the 8 PM hour in Chicago —
 * right through every DST change, without editing the schedule.
 *
 * The work (one Sonnet call per open deal, then a text to John) runs in
 * deal-checkin-run-background, which has the 15-minute budget.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const now = new Date();
  const chicagoHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }).format(now)
  );
  if (chicagoHour !== 20) {
    console.log(`[deal-checkin-nightly] ${now.toISOString()} Chicago hour=${chicagoHour}, not 20 — skipping`);
    return new Response("not 8 PM in Chicago", { status: 200 });
  }

  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const bgUrl = `${baseUrl}/.netlify/functions/deal-checkin-run-background`;
  console.log(`[deal-checkin-nightly] ${now.toISOString()} kicking ${bgUrl}`);
  try {
    const res = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
      body: JSON.stringify({}),
    });
    console.log(`[deal-checkin-nightly] kick status=${res.status}`);
    return new Response(`kicked, status=${res.status}`, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[deal-checkin-nightly] kick failed:", err);
    return new Response(`kick failed: ${msg}`, { status: 500 });
  }
}

export const config: Config = {
  // 01:45 and 02:45 UTC daily; the handler keeps whichever is 8:45 PM CT.
  schedule: "45 1,2 * * *",
};
