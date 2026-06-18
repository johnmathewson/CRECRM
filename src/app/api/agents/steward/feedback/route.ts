/**
 * POST /api/agents/steward/feedback
 *
 * Appends a feedback event to the daily_briefings row. Two event types:
 *
 *   { type: "thumbs", briefId, section, value: "up" | "down" }
 *     → appends to feedback_thumbs and de-dupes by section
 *       (clicking again replaces the prior value for the same section).
 *
 *   { type: "chat", briefId, message }
 *     → appends to feedback_chat as { message, at }.
 *
 * Feedback is read by Steward's daily reflection (added in a follow-up).
 * Three triggers fire a proposed playbook edit:
 *   - 3+ similar thumbs-downs in the last 14 days
 *   - Direct instructions ("from now on...", "stop...", "always...")
 *   - Critical-miss flag from the user
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface ThumbsBody {
  type: "thumbs";
  briefId: string;
  section: string;
  value: "up" | "down";
}

interface ChatBody {
  type: "chat";
  briefId: string;
  message: string;
}

type FeedbackBody = ThumbsBody | ChatBody;

export async function POST(req: NextRequest) {
  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.briefId || !body?.type) {
    return NextResponse.json({ error: "briefId and type required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Load current arrays so we can append + de-dupe in JS land. Cheaper
  // than building a jsonb manipulation that handles both shapes.
  const { data: row, error: loadErr } = await supabase
    .from("daily_briefings")
    .select("feedback_thumbs, feedback_chat")
    .eq("id", body.briefId)
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "briefing not found" }, { status: 404 });

  const at = new Date().toISOString();
  const existingThumbs = Array.isArray(row.feedback_thumbs) ? row.feedback_thumbs : [];
  const existingChat = Array.isArray(row.feedback_chat) ? row.feedback_chat : [];

  if (body.type === "thumbs") {
    if (!body.section || (body.value !== "up" && body.value !== "down")) {
      return NextResponse.json({ error: "thumbs requires section + value(up|down)" }, { status: 400 });
    }
    // Replace any prior thumb on the same section.
    const cleaned = existingThumbs.filter((t: any) => t?.section !== body.section);
    const next = [...cleaned, { section: body.section, value: body.value, at }];
    const { error } = await supabase
      .from("daily_briefings")
      .update({ feedback_thumbs: next })
      .eq("id", body.briefId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, type: "thumbs", section: body.section, value: body.value });
  }

  if (body.type === "chat") {
    const msg = String(body.message ?? "").trim();
    if (!msg) return NextResponse.json({ error: "message required" }, { status: 400 });
    if (msg.length > 4000) return NextResponse.json({ error: "message too long (max 4000)" }, { status: 400 });
    const next = [...existingChat, { message: msg, at }];
    const { error } = await supabase
      .from("daily_briefings")
      .update({ feedback_chat: next })
      .eq("id", body.briefId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, type: "chat", at });
  }

  return NextResponse.json({ error: "unknown feedback type" }, { status: 400 });
}
