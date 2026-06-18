import { createClient } from "@supabase/supabase-js";
import { marked } from "marked";
import { TodayBriefView } from "@/components/cre-os/today/TodayBriefView";

/**
 * /cre-os/today — Steward's morning brief inside the CRM.
 *
 * Same source of truth as the email: reads the most recent row from
 * daily_briefings. Renders content_text as page-styled HTML (we don't
 * reuse the email-grade content_html because it's a full document
 * with inline styles tuned for Gmail/Apple Mail).
 *
 * Feedback widgets at the bottom write back to the same row's
 * feedback_thumbs / feedback_chat columns via /api/agents/steward/feedback.
 *
 * The regenerate button hits /api/agents/steward/run (which kicks the
 * background function). Polling logic + "updated" reload lives in the
 * client view.
 */

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export const dynamic = "force-dynamic";

export interface TodayBriefingRow {
  id: string;
  brief_type: "daily" | "weekly";
  brief_date: string;
  generated_at: string;
  content_text: string;
  content_html_inner: string;
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

async function loadLatestBrief(): Promise<TodayBriefingRow | null> {
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

  // The daily_briefings table isn't in the generated Supabase TS types
  // yet, so the row comes back typed as a generic record. Cast and
  // narrow at this seam — every consumer downstream of this function
  // sees a fully-typed TodayBriefingRow.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;

  // Pre-render markdown → HTML on the server so the client component
  // stays small (no marked bundle shipped to the browser).
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

export default async function TodayPage() {
  const brief = await loadLatestBrief();
  return <TodayBriefView brief={brief} />;
}
