/**
 * POST /api/agents/steward/run
 *
 * Manual trigger for the Steward agent. Used for testing + for the
 * "regenerate brief" button on the sidebar.
 *
 * Body:
 *   {
 *     briefType?: "daily" | "weekly",   // defaults to "daily"
 *     briefDate?: "2026-06-17",          // defaults to today's date
 *     dryRun?: boolean,                  // if true, doesn't write to DB
 *   }
 *
 * Auth: this endpoint is open for local/internal testing. Add a
 * x-cron-secret header check before exposing it broader.
 */

import { NextRequest, NextResponse } from "next/server";
import { runStewardBrief } from "@/lib/agents/steward";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Steward can run 30-60s on a busy day

export async function POST(req: NextRequest) {
  let body: { briefType?: "daily" | "weekly"; briefDate?: string; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const result = await runStewardBrief({
      briefType: body.briefType ?? "daily",
      briefDate: body.briefDate,
      dryRun: !!body.dryRun,
    });
    return NextResponse.json({
      ok: true,
      briefing: {
        id: result.briefingId,
        date: result.briefDate,
        type: result.briefType,
        sources_read: result.sourcesRead,
        iterations: result.iterations,
        tokens: result.tokens,
        duration_ms: result.durationMs,
        tool_calls: result.toolCallCount,
        model: result.modelUsed,
      },
      content: result.contentText,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[steward.run]", err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
