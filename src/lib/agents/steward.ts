/**
 * Steward — Chief Operating Officer agent.
 *
 * Loads the playbook from agents/steward.md, runs the agent loop with
 * the Steward tool registry, writes the result to daily_briefings.
 *
 * Separation of concerns:
 *   - This file does the LLM work + DB persistence.
 *   - The render-to-HTML step lives in render-brief.ts.
 *   - The email send step lives in send-brief.ts (added in a follow-up).
 *   - The scheduled function lives in netlify/functions/steward-*.ts.
 *
 * Calling pattern:
 *   const result = await runStewardBrief({ briefType: "daily" });
 *   // result.id, result.contentText, result.contentHtml, etc.
 *
 * The orchestrator is idempotent on the (org, type, date) unique
 * constraint — running it twice on the same day for the same type will
 * upsert (overwrite) the row, not duplicate it. This matters because
 * the cron may fire twice (Netlify retries) and a manual trigger may
 * land mid-morning to regenerate.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { MODELS } from "@/lib/anthropic";
import { runAgent } from "./run-agent";
import { STEWARD_TOOLS } from "./tools/steward-tools";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

// Resolve the playbook path at runtime. process.cwd() is the project
// root in both `next dev` and Netlify builds.
function readPlaybook(): string {
  const path = join(process.cwd(), "agents", "steward.md");
  return readFileSync(path, "utf8");
}

export interface RunStewardOptions {
  briefType: "daily" | "weekly";
  /** Defaults to today's date in ET. Override for backfill / testing. */
  briefDate?: string;
  /** If true, generate the brief but DON'T write to daily_briefings. Useful for previewing. */
  dryRun?: boolean;
}

export interface RunStewardResult {
  briefingId: string | null;
  briefDate: string;
  briefType: "daily" | "weekly";
  contentText: string;
  reasoning: any;
  sourcesRead: Record<string, number>;
  modelUsed: string;
  iterations: number;
  tokens: { input: number; output: number };
  durationMs: number;
  toolCallCount: number;
}

/**
 * The user-message scaffold. Steward's instructions live in the
 * playbook (system prompt); the user message just says "produce the
 * brief for today" and provides the date framing the model needs.
 */
function buildUserMessage(briefType: "daily" | "weekly", briefDate: string): string {
  if (briefType === "weekly") {
    return [
      `Today is Sunday, ${briefDate}. Produce the WEEKLY brief per the playbook.`,
      ``,
      `Follow the "Sunday Week-Ahead Brief" section format exactly:`,
      `  1. Key dates this week`,
      `  2. Listings expected to need attention this week`,
      `  3. Hot leads still in queue`,
      `  4. Last week's recap`,
      `  5. One forward-looking observation`,
      ``,
      `Call the tools you need to ground your analysis. Be concrete. Use names + numbers.`,
      `Output ONLY the brief body in clean markdown. No preamble, no closing remarks, no "here is your brief".`,
    ].join("\n");
  }

  return [
    `Today is ${briefDate}. Produce the DAILY brief per the playbook.`,
    ``,
    `Follow the "Briefing format" section exactly — sections 1 through 7, in order. Skip section 6 (calendar) for now.`,
    ``,
    `Call the tools you need:`,
    `  - get_broker_voice_profile (once, early)`,
    `  - get_yesterday_brief (for continuity / what-changed framing)`,
    `  - get_hot_leads_queued`,
    `  - get_stale_deals (default 7 days)`,
    `  - get_active_properties`,
    `  - get_unreplied_inbound (default 24h)`,
    `  - get_new_crexi_inquiries (default 24h)`,
    `  - get_approaching_key_dates (default 7 days)`,
    ``,
    `Be concrete. Use deal names AND contact names every time (John may not remember which is which).`,
    `Render contact phone numbers as markdown links: [(312) 555-0142](tel:+13125550142). This lets John tap-to-text from his phone.`,
    `Output ONLY the brief body in clean markdown. No preamble, no closing remarks, no "here is your brief".`,
  ].join("\n");
}

export async function runStewardBrief(opts: RunStewardOptions): Promise<RunStewardResult> {
  const briefType = opts.briefType;
  const briefDate = opts.briefDate ?? new Date().toISOString().slice(0, 10);

  const playbook = readPlaybook();
  const userMessage = buildUserMessage(briefType, briefDate);

  const agentResult = await runAgent({
    systemPrompt: playbook,
    userMessage,
    tools: STEWARD_TOOLS,
    model: MODELS.SONNET,
    maxIterations: 15,
    maxTokens: 6144,
    temperature: 0.3,
  });

  // Roll up tool call counts as source-read telemetry. Each unique
  // tool name -> times invoked. The brief footer mentions these so
  // John can see what Steward looked at.
  const sourcesRead: Record<string, number> = {};
  for (const tc of agentResult.toolCalls) {
    sourcesRead[tc.name] = (sourcesRead[tc.name] ?? 0) + 1;
  }

  // The agent emits markdown. Reasoning blob captures the structured
  // tool I/O so the sidebar can re-render rows interactively later.
  const reasoning = {
    tool_calls: agentResult.toolCalls.map((tc) => ({
      name: tc.name,
      input: tc.input,
      duration_ms: tc.durationMs,
      // Skip output (can be huge). The sidebar interactive render can
      // re-fetch via the same tools, or we add output_summary later.
    })),
    stop_reason: agentResult.stopReason,
  };

  if (opts.dryRun) {
    return {
      briefingId: null,
      briefDate,
      briefType,
      contentText: agentResult.text,
      reasoning,
      sourcesRead,
      modelUsed: MODELS.SONNET,
      iterations: agentResult.iterations,
      tokens: { input: agentResult.usage.input_tokens, output: agentResult.usage.output_tokens },
      durationMs: agentResult.durationMs,
      toolCallCount: agentResult.toolCalls.length,
    };
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await sb
    .from("daily_briefings")
    .upsert(
      {
        organization_id: ORG_ID,
        brief_type: briefType,
        brief_date: briefDate,
        generated_at: new Date().toISOString(),
        content_text: agentResult.text,
        content_html: null, // render-brief.ts populates this in a follow-up
        reasoning,
        sources_read: sourcesRead,
        model_used: MODELS.SONNET,
        agent_iterations: agentResult.iterations,
        tokens_input: agentResult.usage.input_tokens,
        tokens_output: agentResult.usage.output_tokens,
        duration_ms: agentResult.durationMs,
        tool_calls: agentResult.toolCalls.map((tc) => ({
          name: tc.name,
          duration_ms: tc.durationMs,
          error: tc.error ?? null,
        })),
      },
      { onConflict: "organization_id,brief_type,brief_date" }
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to persist briefing: ${error.message}`);
  }

  return {
    briefingId: data?.id ?? null,
    briefDate,
    briefType,
    contentText: agentResult.text,
    reasoning,
    sourcesRead,
    modelUsed: MODELS.SONNET,
    iterations: agentResult.iterations,
    tokens: { input: agentResult.usage.input_tokens, output: agentResult.usage.output_tokens },
    durationMs: agentResult.durationMs,
    toolCallCount: agentResult.toolCalls.length,
  };
}
