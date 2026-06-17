/**
 * Generic tool-using agent loop.
 *
 * Takes a system prompt + a set of tools + an initial user message.
 * Runs the Anthropic Messages API in a loop, executing tools whenever
 * the model emits a `tool_use` block, until the model returns
 * `stop_reason: "end_turn"` (or we hit maxIterations as a safety stop).
 *
 * The final assistant text is returned alongside telemetry: how many
 * iterations ran, which tools were called, what the cumulative token
 * usage was. Callers persist telemetry to whatever audit trail they
 * keep (daily_briefings.error_log, agent_runs table, etc.).
 *
 * Anthropic's tool-use protocol in one paragraph: the request sends a
 * `tools: [...]` array describing each tool's input_schema. The model
 * replies with content blocks that can be `text` or `tool_use`. For
 * each `tool_use` block we execute the matching handler, then send the
 * NEXT user-role message containing one `tool_result` block per
 * tool_use, referencing the original by id. Repeat until stop_reason is
 * `end_turn`.
 */

import {
  AnthropicError,
  MODELS,
  callAnthropic,
  type AnthropicMessage,
  type AnthropicToolDefinition,
} from "@/lib/anthropic";

export interface Tool<Input = any, Output = any> {
  definition: AnthropicToolDefinition;
  handler: (input: Input) => Promise<Output> | Output;
}

export interface RunAgentOptions {
  systemPrompt: string;
  userMessage: string;
  tools: Tool[];
  /** Default Sonnet. Pass MODELS.HAIKU/OPUS to override. */
  model?: string;
  /** Hard cap on agent iterations. Default 12 — generous for complex multi-tool flows but not infinite. */
  maxIterations?: number;
  /** Max tokens per call. Default 4096 — briefings can run long. */
  maxTokens?: number;
  /** 0.0–1.0. Default 0.4 — analytical work, not creative. */
  temperature?: number;
}

export interface ToolCall {
  name: string;
  input: any;
  output: any;
  durationMs: number;
  error?: string;
}

export interface RunAgentResult {
  /** Final assistant text — the synthesized output you'd show the user. */
  text: string;
  /** Full message history (initial user + all assistant + tool_result turns). */
  messages: AnthropicMessage[];
  /** Every tool call that fired, in order. */
  toolCalls: ToolCall[];
  /** How many full iterations of the agent loop ran. */
  iterations: number;
  /** Cumulative token usage across all calls in the loop. */
  usage: { input_tokens: number; output_tokens: number };
  /** Total elapsed time across all model calls + tool calls. */
  durationMs: number;
  /** Why the loop terminated — usually "end_turn", but could be "max_iterations" or "error". */
  stopReason: string;
}

/**
 * Run an agent until it finishes or hits the iteration cap.
 *
 * Errors thrown by tool handlers are CAUGHT and surfaced back to the
 * model as `is_error: true` tool_results — the agent gets a chance to
 * recover (try a different tool, ask for more context, give up
 * gracefully). Catastrophic errors (Anthropic API down, tool returns
 * non-JSON-serializable garbage) propagate out.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const model = opts.model ?? MODELS.SONNET;
  const maxIterations = opts.maxIterations ?? 12;
  const startedAt = Date.now();

  const toolsByName = new Map<string, Tool>();
  for (const t of opts.tools) toolsByName.set(t.definition.name, t);

  const messages: AnthropicMessage[] = [
    { role: "user", content: opts.userMessage },
  ];
  const toolCalls: ToolCall[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let i = 1; i <= maxIterations; i++) {
    const response = await callAnthropic({
      model,
      system: opts.systemPrompt,
      messages,
      maxTokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.4,
      tools: opts.tools.map((t) => t.definition),
    });

    if (response.usage) {
      usage.input_tokens += response.usage.input_tokens;
      usage.output_tokens += response.usage.output_tokens;
    }

    // Always hand the assistant turn back unchanged on the next call —
    // Anthropic requires the full content array to preserve tool_use
    // block IDs.
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((c) => c.type === "tool_use");

    if (response.stopReason === "end_turn" || toolUses.length === 0) {
      return {
        text: response.text,
        messages,
        toolCalls,
        iterations: i,
        usage,
        durationMs: Date.now() - startedAt,
        stopReason: response.stopReason ?? "end_turn",
      };
    }

    // Execute every tool_use block in this turn, in parallel.
    // Tool handlers should be idempotent and side-effect-free for the
    // briefing agent (read-only Supabase queries). Future write-capable
    // tools should serialize themselves.
    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        const toolStartedAt = Date.now();
        const tool = toolsByName.get(tu.name ?? "");
        if (!tool) {
          const err = `Unknown tool: ${tu.name}`;
          toolCalls.push({
            name: tu.name ?? "?",
            input: tu.input,
            output: { error: err },
            durationMs: 0,
            error: err,
          });
          return { type: "tool_result", tool_use_id: tu.id, content: err, is_error: true };
        }

        try {
          const output = await tool.handler(tu.input ?? {});
          toolCalls.push({
            name: tool.definition.name,
            input: tu.input,
            output,
            durationMs: Date.now() - toolStartedAt,
          });
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            content: typeof output === "string" ? output : JSON.stringify(output),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolCalls.push({
            name: tool.definition.name,
            input: tu.input,
            output: { error: msg },
            durationMs: Date.now() - toolStartedAt,
            error: msg,
          });
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Tool error: ${msg}`,
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: "user", content: toolResults });
  }

  // We hit the iteration cap without an end_turn. Return whatever the
  // last assistant turn produced — usually still useful, just truncated.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastText =
    Array.isArray(lastAssistant?.content)
      ? lastAssistant!.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("")
      : "";

  return {
    text: lastText,
    messages,
    toolCalls,
    iterations: maxIterations,
    usage,
    durationMs: Date.now() - startedAt,
    stopReason: "max_iterations",
  };
}

// Re-export so callers don't need to know about AnthropicError directly
// when they only care about the agent layer.
export { AnthropicError };
