/**
 * GET /api/extension/pending
 *
 * Polled by the extension every ~60 seconds. Returns pending sync requests
 * (rows in metric_sync_requests not yet fulfilled or failed) along with the
 * properties' external listing IDs and URLs so the extension knows which
 * tabs to scrape.
 *
 * Auth: same x-extension-key header as /sync.
 */

import { NextRequest, NextResponse } from "next/server";
import { ORG_ID, hashSecret } from "@/lib/owner-dashboard";
import { createServiceSupabase } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-extension-key",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: NextRequest) {
  const supabase = createServiceSupabase();
  const key = req.headers.get("x-extension-key");
  if (!key) {
    return NextResponse.json({ error: "Missing x-extension-key" }, { status: 401, headers: corsHeaders() });
  }
  const { data: keyRow } = await supabase
    .from("extension_api_keys")
    .select("id, revoked_at")
    .eq("key_hash", hashSecret(key))
    .eq("organization_id", ORG_ID)
    .maybeSingle();
  if (!keyRow || keyRow.revoked_at) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401, headers: corsHeaders() });
  }

  const { data: pending } = await supabase
    .from("metric_sync_requests")
    .select(`
      id, source, requested_at, reason,
      property:properties(id, name, crexi_url, crexi_listing_id, loopnet_url, loopnet_listing_id)
    `)
    .eq("organization_id", ORG_ID)
    .is("fulfilled_at", null)
    .is("failed_at", null)
    .order("requested_at", { ascending: true })
    .limit(20);

  return NextResponse.json({ pending: pending || [] }, { headers: corsHeaders() });
}
