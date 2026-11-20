/**
 * Netlify scheduled function — parcel map listings sync.
 *
 * Daily at 11:15 UTC (06:15 CT): mirrors our own CRM listings into
 * map_listings so the Hobart parcel map paints them as on market. Third-party
 * listings (CREXi / LoopNet) arrive from the Chrome extension's daily
 * capture, not from here — those sites refuse server requests.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not configured", { status: 500 });
  try {
    const res = await fetch(`${baseUrl}/api/map/listings/sync`, {
      method: "POST",
      headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
    });
    const text = await res.text();
    console.log(`[map-listings-sync] status=${res.status} body=${text.slice(0, 400)}`);
    return new Response(text, { status: res.status });
  } catch (err) {
    console.error("[map-listings-sync] fetch error:", err);
    return new Response(`error: ${err instanceof Error ? err.message : err}`, { status: 500 });
  }
}

export const config: Config = {
  schedule: "15 11 * * *",
};
