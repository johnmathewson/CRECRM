/**
 * PATCH  /api/tasks/[id]  — update title / due / priority / status / etc.
 *                            Setting status='completed' also stamps
 *                            completed_at. Cleared = back to 'pending'.
 *
 * DELETE /api/tasks/[id]  — hard delete. No soft-delete column on tasks
 *                            (unlike documents); the audit trail lives in
 *                            activity logs instead.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

const PATCHABLE_FIELDS = new Set([
  "title", "description", "status", "priority",
  "due_date", "due_time", "completed_at",
  "assigned_to", "contact_id", "property_id", "deal_id",
]);
const ALLOWED_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);
const ALLOWED_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  let body: Record<string, any>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const update: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE_FIELDS.has(k)) {
      update[k] = v === "" ? null : v;
    }
  }

  // Validate enums
  if ("status" in update && update.status !== null && !ALLOWED_STATUSES.has(update.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if ("priority" in update && update.priority !== null && !ALLOWED_PRIORITIES.has(update.priority)) {
    return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
  }

  // Auto-stamp completed_at when status flips to completed; clear it when
  // the task is reopened. The broker checks a checkbox; the rest is housekeeping.
  if ("status" in update) {
    if (update.status === "completed") {
      update.completed_at = new Date().toISOString();
    } else if (update.status === "pending" || update.status === "in_progress") {
      update.completed_at = null;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const sb = svc();
  const { data, error } = await sb
    .from("tasks")
    .update(update)
    .eq("id", params.id)
    .eq("organization_id", ORG_ID)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = svc();
  const { error } = await sb
    .from("tasks")
    .delete()
    .eq("id", params.id)
    .eq("organization_id", ORG_ID);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
