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

  const result = await draftLeadReply({
    supabase,
    organizationId: ORG_ID,
    leadId,
    tone,
    engagementSignal: body.engagement_signal || null,
    // force = John pressed the button: draft even if a draft exists or a
    // reply was already sent (a follow-up). The drafter still refuses spam.
    force: !!body.force,
  });

  if (!result.ok) {
    // A draft that already exists IS the answer the caller wants.
    if (result.skipped === "already_drafted" && result.draft) {
      return NextResponse.json({ ok: true, lead_id: leadId, tone, draft: result.draft, reused: true });
    }
    const reason =
      result.skipped === "already_sent" ? "A reply was already sent on this lead — pass force to draft a follow-up."
      : result.skipped === "no_email" ? "This lead has no email address to draft to."
      : result.skipped === "spam" ? "This lead is marked spam."
      : result.error || "Drafter failed";
    return NextResponse.json(
      { ok: false, error: reason, skipped: result.skipped || null },
      { status: result.skipped ? 409 : 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    tone,
    // The full draft — the panel puts it straight into the composer.
    draft: result.draft,
    draft_preview: result.draft?.slice(0, 200) || null,
    char_count: result.draft?.length || 0,
    model: result.model,
  });
}
