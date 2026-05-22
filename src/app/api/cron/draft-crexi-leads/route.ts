/**
 * POST /api/cron/draft-crexi-leads
 *
 * Scheduled drafting for CREXi hot leads. Triggered every 5 minutes by
 * netlify/functions/draft-crexi-leads.ts.
 *
 * Picks up to BATCH_SIZE `leads` rows where:
 *   - source = 'crexi'
 *   - status = 'new'
 *   - draft_reply IS NULL (not yet drafted)
 *   - final_sent_at IS NULL (not yet sent)
 *
 * For each, applies the dedupe gate inside draftLeadReply (skips if
 * already_sent / already_drafted / spam), then calls
 * draftLeadReply({ tone: "proactive_engagement" }).
 *
 * Batch size of 5 keeps us comfortably under the 60s maxDuration even if
 * each Sonnet call takes ~8s. Once all backlog leads are drafted, this
 * cron becomes a no-op until the next daily CREXi import lands.
 *
 * Auth: requires x-cron-secret header matching CRON_SECRET env var.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { draftLeadReply } from "@/lib/draft-lead-reply";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const BATCH_SIZE = 5;

interface DraftResult {
  id: string;
  name: string;
  outcome: "drafted" | "skipped" | "error";
  reason?: string;
}

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = req.headers.get("x-cron-secret");
    if (provided !== cronSecret) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Find undrafted CREXi leads ──────────────────────────────────────────
  const { data: leads, error: fetchErr } = await supabase
    .from("leads")
    .select("id, contact_id, property_id, qualifier_summary, raw_body, sender_name, sender_email")
    .eq("organization_id", ORG_ID)
    .eq("source", "crexi")
    .eq("status", "new")
    .is("draft_reply", null)
    .is("final_sent_at", null)
    .order("created_at", { ascending: true }) // oldest-first: draft in arrival order
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error("[draft-crexi-leads] fetch failed:", fetchErr.message);
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({ ok: true, drafted: 0, skipped: 0, errors: 0, message: "no undrafted crexi leads" });
  }

  console.log(`[draft-crexi-leads] found ${leads.length} undrafted leads`);

  const results: DraftResult[] = [];

  for (const lead of leads) {
    // Extract the pre-built engagement signal from raw_body (set at lead
    // creation time in ensureHotLeadRow). Fall back to qualifier_summary.
    let engagementSignal: string | null = null;
    if (lead.raw_body) {
      try {
        const rb = JSON.parse(lead.raw_body);
        engagementSignal = rb.engagement_signal ?? null;
      } catch {
        // raw_body wasn't valid JSON — fall through to qualifier_summary
      }
    }
    if (!engagementSignal && lead.qualifier_summary) {
      engagementSignal = lead.qualifier_summary;
    }

    try {
      const result = await draftLeadReply({
        supabase,
        organizationId: ORG_ID,
        leadId: lead.id,
        tone: "proactive_engagement",
        engagementSignal,
      });

      if (result.ok) {
        results.push({ id: lead.id, name: lead.sender_name || "unknown", outcome: "drafted" });
      } else if (result.skipped) {
        results.push({
          id: lead.id,
          name: lead.sender_name || "unknown",
          outcome: "skipped",
          reason: result.skipped,
        });
      } else {
        results.push({
          id: lead.id,
          name: lead.sender_name || "unknown",
          outcome: "error",
          reason: result.error || "unknown error",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ id: lead.id, name: lead.sender_name || "unknown", outcome: "error", reason: message });
      console.error(`[draft-crexi-leads] error drafting ${lead.id}:`, message);
    }
  }

  const drafted = results.filter((r) => r.outcome === "drafted").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const errors = results.filter((r) => r.outcome === "error").length;

  console.log(`[draft-crexi-leads] done: ${drafted} drafted, ${skipped} skipped, ${errors} errors`);

  return NextResponse.json({
    ok: true,
    total_found: leads.length,
    drafted,
    skipped,
    errors,
    results,
  });
}

// Allow GET for manual health-check / debug from browser with the secret
export async function GET(req: NextRequest) {
  return POST(req);
}
