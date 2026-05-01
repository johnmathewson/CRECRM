/**
 * Netlify scheduled function — fires every minute and triggers the
 * Gmail polling cron at /api/cron/poll-gmail.
 *
 * Schedule: standard cron — every minute.
 *
 * Heartbeat: this function writes a "function-heartbeat:<timestamp>"
 * marker to gmail_oauth_tokens.poll_error at the start of every run.
 * That gives us an independent signal of whether the scheduled function
 * is firing at all — independent of the inner route, the CRON_SECRET,
 * or Netlify's log UI. If the heartbeat doesn't appear in the DB, the
 * function isn't running at all.
 *
 * On success the route's own writes overwrite the heartbeat with
 * last_polled_at + cleared poll_error. On failure the heartbeat stays
 * visible until the next successful run.
 */

import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export default async function handler() {
  const startedAt = new Date().toISOString();
  console.log(`[poll-gmail] start ${startedAt}`);

  // ── Heartbeat: write to DB FIRST, before any other work ──
  let heartbeatErr: string | null = null;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await supabase
      .from("gmail_oauth_tokens")
      .update({ poll_error: `function-heartbeat:${startedAt}` })
      .eq("organization_id", ORG_ID)
      .is("revoked_at", null);
    if (error) heartbeatErr = error.message;
  } catch (err: any) {
    heartbeatErr = err?.message || String(err);
  }
  if (heartbeatErr) {
    console.error(`[poll-gmail] heartbeat write failed: ${heartbeatErr}`);
  }

  const baseUrl = process.env.URL || "https://stewardship-crm.netlify.app";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("[poll-gmail] CRON_SECRET not set in function env");
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  console.log(`[poll-gmail] CRON_SECRET present (length=${secret.length}), calling ${baseUrl}/api/cron/poll-gmail`);

  try {
    const res = await fetch(`${baseUrl}/api/cron/poll-gmail`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    const text = await res.text();
    console.log(`[poll-gmail] status=${res.status} body=${text.slice(0, 400)}`);
    return new Response(text, { status: res.status });
  } catch (err: any) {
    console.error("[poll-gmail] fetch error:", err);
    return new Response(`error: ${err?.message || err}`, { status: 500 });
  }
}

export const config: Config = {
  schedule: "* * * * *",
};
