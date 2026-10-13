import { createClient } from "@supabase/supabase-js";
import { marked } from "marked";

/**
 * Steward's morning brief — same source of truth as the email (the most
 * recent daily_briefings row). Used by /cre-os/today (summary) and
 * /cre-os/today/brief (full render + feedback).
 */

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export interface TodayBriefingRow {
  id: string;
  brief_type: "daily" | "weekly";
  brief_date: string;
  generated_at: string;
  content_text: string;
  content_html_inner: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reasoning: any;
  sources_read: Record<string, number>;
  email_sent_at: string | null;
  feedback_thumbs: Array<{ section: string; value: "up" | "down"; at: string }>;
  feedback_chat: Array<{ message: string; at: string }>;
  model_used: string | null;
  agent_iterations: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  duration_ms: number | null;
}

export async function loadLatestBrief(): Promise<TodayBriefingRow | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data, error } = await supabase
    .from("daily_briefings")
    .select(
      "id, brief_type, brief_date, generated_at, content_text, reasoning, sources_read, " +
        "email_sent_at, feedback_thumbs, feedback_chat, model_used, agent_iterations, " +
        "tokens_input, tokens_output, duration_ms"
    )
    .eq("organization_id", ORG_ID)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // daily_briefings isn't in the generated Supabase TS types; narrow here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;

  // Pre-render markdown → HTML on the server so the client stays small.
  const inner = marked.parse(row.content_text ?? "", { gfm: true, breaks: false, async: false }) as string;

  return {
    id: row.id,
    brief_type: row.brief_type,
    brief_date: row.brief_date,
    generated_at: row.generated_at,
    content_text: row.content_text,
    content_html_inner: inner,
    reasoning: row.reasoning ?? {},
    sources_read: row.sources_read ?? {},
    email_sent_at: row.email_sent_at,
    feedback_thumbs: Array.isArray(row.feedback_thumbs) ? row.feedback_thumbs : [],
    feedback_chat: Array.isArray(row.feedback_chat) ? row.feedback_chat : [],
    model_used: row.model_used,
    agent_iterations: row.agent_iterations,
    tokens_input: row.tokens_input,
    tokens_output: row.tokens_output,
    duration_ms: row.duration_ms,
  };
}

/** The brief's opening, as plain text, for the Today header. Skips the
 *  title line and markdown furniture; capped so it reads as a lede. */
export function briefLede(contentText: string, maxChars = 320): string {
  const paragraphs = contentText
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/^#{1,6}\s+.*$/gm, "")             // headings
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")   // links → text
        .replace(/[*_`>#]/g, "")                   // emphasis, code, quotes
        .replace(/^\s*[-•]\s+/gm, "")              // bullets
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((p) => p.length > 40);
  const text = paragraphs.slice(0, 2).join(" ");
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  return cut.slice(0, Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "))) + "…";
}
