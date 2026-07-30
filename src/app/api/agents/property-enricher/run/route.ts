/**
 * POST /api/agents/property-enricher/run — execute one enrichment batch.
 *   Auth: x-cron-secret header (scheduled function) OR a logged-in session
 *   (manual trigger). Body: { batchSize? }.
 *
 * GET — last 10 runs with summaries (the visible diff), session-authed.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { runPropertyEnricher } from "@/lib/agents/property-enricher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") === secret) return true;
  const authSb = createServerSupabase();
  const { data: { user } } = await authSb.auth.getUser();
  return !!user;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let batchSize: number | undefined;
  try {
    const body = await req.json();
    if (body?.batchSize) batchSize = Number(body.batchSize);
  } catch { /* empty body is fine */ }

  try {
    const result = await runPropertyEnricher({ batchSize });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Enricher failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await sb
    .from("enrichment_runs")
    .select("id, agent, started_at, finished_at, scanned, facts_written, fields_filled, conflicts, summary")
    .eq("agent", "property_enricher")
    .order("started_at", { ascending: false })
    .limit(10);
  return NextResponse.json({ runs: data ?? [] });
}
