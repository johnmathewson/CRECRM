/**
 * POST /api/agents/steward/run
 *
 * Kicks off a Steward brief generation via the Netlify Background
 * Function (steward-run-background). Returns 202 immediately —
 * Steward's real run takes 30-90s, well beyond the Netlify Edge
 * synchronous timeout, so we don't try to wait synchronously here.
 *
 * Body (all optional):
 *   {
 *     briefType?: "daily" | "weekly",   // defaults to "daily"
 *     briefDate?: "2026-06-17",          // defaults to today's date
 *     dryRun?: boolean,                  // if true, skips DB write
 *   }
 *
 * Response:
 *   202: { ok: true, status: "queued", message: "..." }
 *   500: { ok: false, error: "..." }
 *
 * Caller polls `daily_briefings` (filter org_id + brief_type + today's
 * date) to see when the row appears. The sidebar "Today's Brief" view
 * does exactly this with a 5s refresh.
 *
 * Auth: open for now (single-tenant, behind the broker's session). Add
 * a session check before this is reachable from anywhere John doesn't
 * personally control.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
// This route returns ~immediately. The actual agent work happens in
// the background function. Keep maxDuration small so a hung kick
// surfaces fast.
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  let body: { briefType?: "daily" | "weekly"; briefDate?: string; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Background function URL. In production, the Next.js route and the
  // background function live on the same Netlify site, so the function
  // URL is resolvable via relative path or the URL env var.
  const baseUrl = process.env.URL || req.nextUrl.origin;
  const bgUrl = `${baseUrl}/.netlify/functions/steward-run-background`;

  try {
    // Fire-and-forget: kick the background function, don't await its
    // completion. We get back a 202 from Netlify as soon as it accepts
    // the request — that's our "queued" signal.
    const res = await fetch(bgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // Netlify Background Functions return 202. Anything outside 200-299
    // means the kick itself failed (not the agent — the kick).
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      throw new Error(`Background function kick failed: HTTP ${res.status} ${text.slice(0, 200)}`);
    }

    return NextResponse.json(
      {
        ok: true,
        status: "queued",
        message:
          "Steward is generating the brief. Poll daily_briefings (filter org + type + date) or refresh the sidebar to see the result.",
        brief_type: body.briefType ?? "daily",
        brief_date: body.briefDate ?? new Date().toISOString().slice(0, 10),
        dry_run: !!body.dryRun,
      },
      { status: 202 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[steward.run] kick failed:", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
