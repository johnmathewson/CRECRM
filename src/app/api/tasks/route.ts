/**
 * POST /api/tasks  — create a task.
 *
 * Body:
 *   title         (required)
 *   description?
 *   priority?     'low' | 'medium' | 'high' | 'urgent' (default 'medium')
 *   due_date?     ISO date (YYYY-MM-DD)
 *   due_time?     HH:MM
 *   property_id?
 *   contact_id?
 *   deal_id?
 *
 * Status defaults to 'pending'. At least one of property_id / contact_id /
 * deal_id is recommended (otherwise the task is orphaned and only shows
 * in a global tasks view), but not strictly required.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

const ALLOWED_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const priority = (ALLOWED_PRIORITIES as readonly string[]).includes(body.priority)
    ? body.priority
    : "medium";

  const insertPayload: Record<string, any> = {
    organization_id: ORG_ID,
    title,
    status: "pending",
    priority,
    description: String(body.description ?? "").trim() || null,
    due_date: body.due_date || null,
    due_time: body.due_time || null,
    property_id: body.property_id || null,
    contact_id: body.contact_id || null,
    deal_id: body.deal_id || null,
    created_by: USER_ID,
    assigned_to: body.assigned_to || USER_ID,
  };

  const sb = svc();
  const { data, error } = await sb.from("tasks").insert(insertPayload).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data }, { status: 201 });
}
