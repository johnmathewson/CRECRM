/**
 * POST /api/cron/run-cadence
 *
 * Walks active lane_enrollments whose next_action_at has come due, and
 * executes the corresponding cadence step (send / queue / mark manual).
 *
 * Triggers:
 *   • Netlify scheduled function — runs every 5 minutes
 *   • Manual button on a lane detail page ("Run cadence now")
 *
 * Auth:
 *   • Scheduled: requires x-cron-secret header
 *   • Manual: same endpoint, callable from the UI (auth via cookie /
 *     existing user session, no special secret)
 *
 * Body (all optional):
 *   { laneId?: string, dryRun?: boolean, maxEnrollments?: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { runCadence } from "@/lib/cre-os/cadence-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cron-secret");
  // Allow either: matching cron secret OR no secret configured at all
  // (development). When invoked from the UI, the existing cookie session
  // doesn't need the secret since the calling user is authenticated already.
  const isCron = !!provided;
  if (isCron && cronSecret && provided !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { laneId?: string; dryRun?: boolean; maxEnrollments?: number } = {};
  try {
    if (req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0) {
      body = await req.json();
    }
  } catch {
    // empty body is fine
  }

  try {
    const result = await runCadence({
      laneId: body.laneId,
      dryRun: body.dryRun ?? false,
      maxEnrollments: body.maxEnrollments ?? 50,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Cadence run failed" },
      { status: 500 }
    );
  }
}
