/**
 * Voice examples — capture + retrieve the broker's real sent emails so
 * future AI drafts pattern-match on them as few-shot examples.
 *
 * Architecture:
 *   - Every Compose send + bulk-followup send + reply-send writes one row
 *     into `voice_examples` with the persona it was for, the property it
 *     was about, and the recipient's engagement signal.
 *   - When the personalizer drafts a new email, it retrieves the top-N
 *     "most relevant" past examples for (persona, property, engagement)
 *     and includes them in the prompt as few-shot demonstrations.
 *   - Starred examples get preferred. Blocked examples get excluded.
 *
 * MVP retrieval is filter-and-rank (no embeddings yet). Once we have ~50
 * examples we'll add pgvector embeddings for true semantic similarity.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export type VoiceExampleSource = "ai_drafted" | "ai_edited" | "manual";

export interface CaptureVoiceExampleInput {
  /** "email" | "sms" */
  channel: "email" | "sms";
  /** Subject line (empty string for SMS) */
  subject?: string | null;
  /** The actual body that was sent */
  body: string;
  /** How this email was produced */
  source: VoiceExampleSource;
  /** If AI-edited: the diff between the AI draft and what got sent. Optional. */
  userEditsDiff?: string | null;
  /** Persona slug (e.g. "listing_inquiry_followup") used for this draft.
   *  We resolve it to a persona_id below. */
  personaSlug?: string | null;
  /** Property the email was about, if any */
  propertyId?: string | null;
  /** What the recipient did to be in our outreach (e.g. "Executed CA") */
  recipientEngagement?: string | null;
  /** Optional snapshot of recipient info for retrieval relevance */
  recipientProfileSnapshot?: Record<string, unknown> | null;
  /** When the email was sent (ISO). Defaults to now. */
  sentAt?: string;
}

export interface VoiceExample {
  id: string;
  persona_id: string | null;
  property_id: string | null;
  channel: string;
  subject: string | null;
  body: string;
  source: VoiceExampleSource;
  recipient_engagement: string | null;
  sent_at: string;
  is_starred: boolean;
}

/**
 * Capture one sent email. Best-effort — failures here should NEVER break
 * the send path. Catch + log; the email still went out.
 */
export async function captureVoiceExample(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  input: CaptureVoiceExampleInput
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    // Resolve persona slug → persona_id (nullable)
    let personaId: string | null = null;
    if (input.personaSlug) {
      const { data: p } = await sb
        .from("personas")
        .select("id")
        .eq("organization_id", ORG_ID)
        .eq("slug", input.personaSlug)
        .maybeSingle();
      personaId = (p?.id as string) ?? null;
    }

    const { data, error } = await sb
      .from("voice_examples")
      .insert({
        organization_id: ORG_ID,
        persona_id: personaId,
        property_id: input.propertyId ?? null,
        channel: input.channel,
        subject: input.subject ?? null,
        body: input.body,
        source: input.source,
        user_edits_diff: input.userEditsDiff ?? null,
        recipient_engagement: input.recipientEngagement ?? null,
        recipient_profile_snapshot: input.recipientProfileSnapshot ?? null,
        sent_at: input.sentAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id as string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Retrieve top-N relevant past examples for a draft. Used by the
 * personalizer to include them as few-shot demonstrations.
 *
 * Ranking (MVP — no embeddings yet):
 *   - Hard filter: same persona (when specified), not blocked
 *   - Prefer: same property (highest), then starred, then most recent
 *   - Cap: limit (default 5)
 *
 * Returns the body + subject + sent_at. Drops the rest (no need to
 * surface the recipient or property details to the model — we only
 * want the broker's voice signature).
 */
export async function retrieveVoiceExamples(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: SupabaseClient<any, any, any>,
  opts: {
    personaSlug?: string | null;
    propertyId?: string | null;
    channel?: "email" | "sms";
    limit?: number;
  }
): Promise<VoiceExample[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 15));

  // Resolve persona slug → id
  let personaId: string | null = null;
  if (opts.personaSlug) {
    const { data: p } = await sb
      .from("personas")
      .select("id")
      .eq("organization_id", ORG_ID)
      .eq("slug", opts.personaSlug)
      .maybeSingle();
    personaId = (p?.id as string) ?? null;
  }

  // Build the query — filter by persona (if any) and channel; exclude blocked.
  let q = sb
    .from("voice_examples")
    .select("id, persona_id, property_id, channel, subject, body, source, recipient_engagement, sent_at, is_starred")
    .eq("organization_id", ORG_ID)
    .eq("is_blocked", false);
  if (personaId) q = q.eq("persona_id", personaId);
  if (opts.channel) q = q.eq("channel", opts.channel);

  // Over-fetch then rank in-memory: take 3x the limit, sort by relevance.
  const { data } = await q.order("sent_at", { ascending: false }).limit(limit * 3);
  if (!data || data.length === 0) return [];

  const rows = data as VoiceExample[];
  // Rank: human-written first (manual/edited beat the AI's own unedited
  // output — otherwise the model trains on itself), then same property,
  // starred, recency.
  const now = Date.now();
  const ranked = rows
    .map((r) => {
      let score = 0;
      if (r.source === "manual") score += 4;
      else if (r.source === "ai_edited") score += 2;
      else score -= 2; // ai_drafted: last resort only
      if (opts.propertyId && r.property_id === opts.propertyId) score += 3;
      if (r.is_starred) score += 2;
      const ageDays = (now - new Date(r.sent_at).getTime()) / 86_400_000;
      if (ageDays < 7) score += 1;
      else if (ageDays > 60) score -= 1;
      return { row: r, score };
    })
    .sort((a, b) => b.score - a.score || new Date(b.row.sent_at).getTime() - new Date(a.row.sent_at).getTime())
    .slice(0, limit)
    .map((x) => x.row);

  return ranked;
}

/**
 * Render an array of examples as a few-shot prompt block. Each example
 * shows just the broker's actual output (subject + body) — no recipient
 * details — so the model patterns on voice, not specifics.
 */
export function renderExamplesAsFewShot(examples: VoiceExample[]): string {
  if (examples.length === 0) return "";
  const blocks = examples.map((ex, i) => {
    const subjLine = ex.subject ? `Subject: ${ex.subject}\n` : "";
    return `### Example ${i + 1} ${ex.is_starred ? "(starred by broker)" : ""}\n${subjLine}${ex.body.trim()}`;
  });
  return `### HOW THE BROKER ACTUALLY WRITES (recent real examples — pattern-match the voice, not the specifics):

${blocks.join("\n\n---\n\n")}

The above are real emails the broker has sent. Mimic the cadence, sentence length, tone, and word choice — but do NOT copy specifics like dollar amounts, dates, or property names unless they apply to the CURRENT recipient + property below.`;
}
