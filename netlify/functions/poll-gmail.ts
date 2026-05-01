/**
 * Netlify scheduled function — fires every minute and triggers the
 * Gmail polling cron at /api/cron/poll-gmail.
 *
 * Why split? Netlify's scheduled functions live outside the Next.js app
 * (separate bundle, no easy import of /src). Easiest pattern: this file
 * just makes an HTTP request to the Next.js route, which has full access
 * to all helpers, env vars, and the Supabase client.
 *
 * Schedule: standard cron — every minute.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/api/cron/poll-gmail`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    const text = await res.text();
    console.log(`[poll-gmail] status=${res.status} body=${text.slice(0, 400)}`);
    return new Response(text, { status: res.status });
  } catch (err: any) {
    console.error("[poll-gmail] error:", err);
    return new Response(`error: ${err?.message || err}`, { status: 500 });
  }
}

export const config: Config = {
  schedule: "* * * * *",
};
