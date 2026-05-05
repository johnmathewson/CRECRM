/**
 * GET /api/extension/properties
 *
 * Returns the active CREXi-tracked properties so the extension's leads
 * watcher knows which listing dashboards to iterate over each cycle.
 *
 * Filter rules:
 *  - organization_id matches the API key's org
 *  - crexi_listing_id is non-null (we need an ID to build the URL)
 *  - status is in a "still working it" set (listed / under_contract / for_lease)
 *
 * Auth: same x-extension-key header as the rest of /api/extension/*.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ORG_ID, hashSecret } from "@/lib/owner-dashboard";

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

const ACTIVE_STATUSES = ["listed", "for_lease", "under_contract"];

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const key = req.headers.get("x-extension-key");
  if (!key) {
    return NextResponse.json(
      { error: "Missing x-extension-key" },
      { status: 401, headers: corsHeaders() }
    );
  }

  const { data: keyRow } = await supabase
    .from("extension_api_keys")
    .select("id, revoked_at, organization_id")
    .eq("key_hash", hashSecret(key))
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (!keyRow || keyRow.revoked_at) {
    return NextResponse.json(
      { error: "Invalid key" },
      { status: 401, headers: corsHeaders() }
    );
  }

  // Pull every property with a CREXi listing ID. The watcher decides per-
  // property whether to actually open the dashboard tab — gated on whether
  // the metric snapshot moved since last poll (handled extension-side via
  // chrome.storage; we don't need to track it server-side for v1).
  const { data: properties } = await supabase
    .from("properties")
    .select("id, name, crexi_listing_id, crexi_url, status, pipeline_stage")
    .eq("organization_id", ORG_ID)
    .not("crexi_listing_id", "is", null)
    .in("status", ACTIVE_STATUSES)
    .order("updated_at", { ascending: false });

  return NextResponse.json(
    {
      properties: (properties || []).map((p) => ({
        id: p.id,
        name: p.name,
        crexi_listing_id: p.crexi_listing_id,
        crexi_url: p.crexi_url,
        leads_url: `https://www.crexi.com/property/${p.crexi_listing_id}/dashboard/leads?type=loadAllLeads`,
        status: p.status,
        pipeline_stage: p.pipeline_stage,
      })),
    },
    { headers: corsHeaders() }
  );
}
