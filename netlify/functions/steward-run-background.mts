/**
 * Netlify Background Function for the Steward COO agent.
 *
 * Why a background function: Steward calls Sonnet in a tool loop with
 * up to 15 iterations and ~6k output tokens. Real runs land in the
 * 30-90s window — well past the ~26s Netlify Edge timeout on
 * synchronous functions. Background functions get a 15-minute budget,
 * which is the right shape here.
 *
 * Calling pattern: POST /.netlify/functions/steward-run-background
 * Returns 202 immediately. The actual work writes to the
 * `daily_briefings` table when complete; the caller polls / opens the
 * sidebar to see the result.
 *
 * Filename suffix `-background.mts` is the Netlify magic that flips
 * this into background mode. Don't rename.
 *
 * The Next.js API route at /api/agents/steward/run thin-wraps this:
 * it just kicks the background function and returns 202. Keeps the
 * "call the agent" surface API-shaped from the browser's perspective.
 */

import type { Config } from "@netlify/functions";

// Body shape accepted by both the API route and this function.
interface RunBody {
  briefType?: "daily" | "weekly";
  briefDate?: string;
  dryRun?: boolean;
}

export default async function handler(req: Request) {
  const startedAt = Date.now();
  let body: RunBody = {};
  try {
    body = (await req.json()) as RunBody;
  } catch {
    // Empty body is fine — defaults apply.
  }

  console.log(`[steward-bg] start type=${body.briefType ?? "daily"} date=${body.briefDate ?? "(today)"} dryRun=${!!body.dryRun}`);

  try {
    // Defer the import until inside the handler. The function bundle
    // is smaller because Steward's heavy deps (Supabase, Anthropic)
    // load on first invocation rather than at module-init time.
    const { runStewardBrief } = await import("../../src/lib/agents/steward");
    const result = await runStewardBrief({
      briefType: body.briefType ?? "daily",
      briefDate: body.briefDate,
      dryRun: !!body.dryRun,
    });
    console.log(
      `[steward-bg] done id=${result.briefingId ?? "(dry)"} iterations=${result.iterations} ` +
        `tool_calls=${result.toolCallCount} tokens=${result.tokens.input}+${result.tokens.output} ` +
        `duration_ms=${result.durationMs} elapsed_ms=${Date.now() - startedAt}`
    );
    return new Response(JSON.stringify({ ok: true, briefing_id: result.briefingId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[steward-bg] error:", err);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

// No schedule — this function is invoked on demand, not on a cron.
// The scheduled morning + Sunday triggers live in separate functions
// that POST to this one.
export const config: Config = {};
