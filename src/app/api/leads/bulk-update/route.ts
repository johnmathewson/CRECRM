/**
 * POST /api/leads/bulk-update
 *
 * Apply the same status update (archive, mark spam, restore, etc.) to many
 * leads in one round-trip. Used by the inbox bulk-select toolbar.
 *
 * Body:
 *   {
 *     ids: string[],                                           // lead UUIDs
 *     status: "archived" | "new" | "spam" | "promoted",        // target status
 *     note?: string                                            // optional audit
 *   }
 *
 * Returns: { ok, updated_count, failed_ids }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

const ALLOWED_STATUSES = new Set(["new", "archived", "spam", "promoted", "reviewing"]);

interface BulkUpdateBody {
  ids?: string[];
  status?: string;
  note?: string;
}

export async function POST(req: NextRequest) {
  let body: BulkUpdateBody;
  try {
    body = (await req.json()) as BulkUpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((s): s is string => typeof s === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids array required" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "max 500 ids per request" }, { status: 400 });
  }

  const status = body.status;
  if (!status || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${Array.from(ALLOWED_STATUSES).join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase
    .from("leads")
    .update({ status })
    .in("id", ids)
    .eq("organization_id", ORG_ID)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updatedIdsArr = (data || []).map((r: { id: string }) => r.id);
  const updatedIdsSet = new Set<string>(updatedIdsArr);
  const failedIds = ids.filter((id) => !updatedIdsSet.has(id));

  // Append a single audit event per updated lead
  if (data && data.length > 0) {
    const events = data.map((r: { id: string }) => ({
      organization_id: ORG_ID,
      lead_id: r.id,
      event_type: status === "archived" ? "archived" : status === "spam" ? "spam_flagged" : "status_changed",
      actor: "user" as const,
      summary: body.note || `Status set to ${status} via bulk update`,
      metadata: { bulk: true, target_status: status },
    }));
    await supabase.from("lead_events").insert(events);
  }

  return NextResponse.json({
    ok: true,
    updated_count: data?.length || 0,
    failed_ids: failedIds,
  });
}
