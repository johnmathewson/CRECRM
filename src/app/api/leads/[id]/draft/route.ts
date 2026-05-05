/**
 * POST /api/leads/[id]/draft
 *
 * Admin/agent endpoint: triggers the lead drafter for an existing lead.
 *
 * Use cases:
 *   - Backfill drafts for leads that were created before the drafter was
 *     wired in (e.g. early questionnaire submissions).
 *   - Manually re-fire the drafter from the /agent UI when John wants to
 *     regenerate a draft (sets force=true to overwrite existing).
 *   - Triggered by the proactive CREXi engagement watcher when a lead's
 *     funnel state advances.
 *
 * Body (optional):
 *   {
 *     tone?: "first_touch" | "proactive_engagement",
 *     engagement_signal?: string,
 *     force?: boolean   // if true, overwrites an existing draft
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { draftLeadReply, DraftTone } from "@/lib/draft-lead-reply";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface DraftRequestBody {
  tone?: DraftTone;
  engagement_signal?: string;
  force?: boolean;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params;

  if (!leadId) {
    return NextResponse.json({ error: "lead id required" }, { status: 400 });
  }

  let body: DraftRequestBody = {};
  try {
    body = (await req.json()) as DraftRequestBody;
  } catch {
    // Empty body is fine — defaults to first_touch
  }

  const tone: DraftTone = body.tone || "first_touch";

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // If force, clear existing draft first so the helper doesn't short-circuit
  if (body.force) {
    await supabase.from("leads").update({ draft_reply: null }).eq("id", leadId);
  }

  const result = await draftLeadReply({
    supabase,
    organizationId: ORG_ID,
    leadId,
    tone,
    engagementSignal: body.engagement_signal || null,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error || result.skipped || "unknown",
        skipped: result.skipped || null,
        existing_draft: result.draft || null,
      },
      { status: result.skipped ? 200 : 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    tone,
    draft_preview: result.draft?.slice(0, 200) || null,
    char_count: result.draft?.length || 0,
    model: result.model,
  });
}
