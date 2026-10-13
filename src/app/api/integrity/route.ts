/**
 * /api/integrity — the record's health check.
 *
 *   GET  (session or cron secret) → integrity_scorecard(): every count must
 *        be zero, plus the last alarms. Settings → Integrity renders this.
 *   POST (cron secret, nightly)  → same scorecard; writes a ledger row and
 *        texts John ONLY when something is non-zero or an alarm fired in the
 *        last 24 hours. Silence means clean.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { notifyJohn } from "@/lib/twilio-voice";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

interface Check { key: string; label: string; count: number }
interface Scorecard {
  checked_at: string;
  checks: Check[];
  alarms: Array<{ at: string; kind: string | null; message: string | null; detail: Record<string, unknown> }>;
  totals: Record<string, number>;
}

function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("x-cron-secret") === secret) return true;
  const { data: { user } } = await createServerSupabase().auth.getUser();
  return !!user;
}

async function scorecard(): Promise<Scorecard> {
  const { data, error } = await anonClient().rpc("integrity_scorecard");
  if (error) throw new Error(error.message);
  return data as Scorecard;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await scorecard());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "scorecard failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let card: Scorecard;
  try {
    card = await scorecard();
  } catch (err) {
    const message = err instanceof Error ? err.message : "scorecard failed";
    await notifyJohn(`CRM integrity check could not run: ${message}`).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const nonZero = card.checks.filter((c) => c.count > 0);
  const clean = nonZero.length === 0;

  const sb = anonClient();
  await sb.from("email_ingest_log").insert({
    organization_id: ORG_ID,
    gmail_message_id: `integrity:${card.checked_at}`,
    disposition: "integrity_nightly",
    subject: clean ? "clean" : nonZero.map((c) => `${c.key}=${c.count}`).join(" "),
    detail: { checks: card.checks, totals: card.totals },
  });

  if (!clean) {
    const lines = nonZero.map((c) => `${c.label}: ${c.count}`).join(" · ");
    await notifyJohn(`CRM record check: ${lines}. Settings → Integrity.`.slice(0, 320)).catch(() => {});
  }

  return NextResponse.json({ clean, nonZero, checked_at: card.checked_at });
}
