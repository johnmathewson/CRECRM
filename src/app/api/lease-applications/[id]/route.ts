/**
 * PATCH /api/lease-applications/[id] — move an application through review.
 * Session-authed. Body: { status }.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const REVIEW_STATUSES = ["submitted", "reviewing", "approved", "declined", "withdrawn"];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let status = "";
  try {
    const body = await req.json();
    status = typeof body?.status === "string" ? body.status : "";
  } catch { /* handled below */ }
  if (!REVIEW_STATUSES.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${REVIEW_STATUSES.join(", ")}` }, { status: 400 });
  }

  const { data, error } = await sb
    .from("lease_applications")
    .update({ status })
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .neq("status", "pending_upload")
    .select("id, status")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: data.status });
}
