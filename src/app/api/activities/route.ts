/**
 * POST /api/activities  — log a call / meeting / tour / note / etc.
 *
 * Body:
 *   activity_type     'call' | 'meeting' | 'tour' | 'note' | 'text' | 'email' | 'mail' | 'other'
 *   subject?          one-liner
 *   body?             long-form notes
 *   occurred_at?      ISO timestamp; defaults to now()
 *   duration_minutes? for calls / meetings
 *   property_id?      uuid
 *   contact_id?       uuid
 *   deal_id?          uuid
 *
 * At least one of property_id / contact_id / deal_id must be set —
 * orphan activities don't surface anywhere useful.
 *
 * Read paths already live on each workspace's loader; this endpoint is
 * write-only. The broker hits "+ Log activity" on a property/contact/
 * deal workspace and the dialog calls here.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";
const USER_ID = "b0000000-0000-0000-0000-000000000001";

const ALLOWED_TYPES = ["call", "email", "meeting", "tour", "note", "text", "mail", "other"] as const;
type ActivityType = (typeof ALLOWED_TYPES)[number];

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

  const activityType: ActivityType = (ALLOWED_TYPES as readonly string[]).includes(body.activity_type)
    ? body.activity_type
    : "note";

  const propertyId = body.property_id || null;
  const contactId = body.contact_id || null;
  const dealId = body.deal_id || null;
  if (!propertyId && !contactId && !dealId) {
    return NextResponse.json(
      { error: "At least one of property_id / contact_id / deal_id must be set" },
      { status: 400 }
    );
  }

  const subject = String(body.subject ?? "").trim() || null;
  const bodyText = String(body.body ?? "").trim() || null;
  if (!subject && !bodyText) {
    return NextResponse.json(
      { error: "Activity needs either a subject or a body" },
      { status: 400 }
    );
  }

  const duration =
    body.duration_minutes !== undefined && body.duration_minutes !== null && body.duration_minutes !== ""
      ? Math.max(0, Math.round(Number(body.duration_minutes)))
      : null;

  const occurredAt = body.occurred_at ? new Date(body.occurred_at).toISOString() : new Date().toISOString();

  const sb = svc();
  const { data, error } = await sb
    .from("activities")
    .insert({
      organization_id: ORG_ID,
      activity_type: activityType,
      subject,
      body: bodyText,
      occurred_at: occurredAt,
      duration_minutes: duration,
      property_id: propertyId,
      contact_id: contactId,
      deal_id: dealId,
      created_by: USER_ID,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Side-effect: bump contacts.last_conversation when the activity is a
  // direct touch (call / meeting / tour) and a contact is attached. Drives
  // the warmth score and the "days since touch" surface on the
  // relationships pages without forcing the broker to set the date manually.
  if (contactId && ["call", "meeting", "tour"].includes(activityType)) {
    await sb
      .from("contacts")
      .update({
        last_conversation: occurredAt.slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("id", contactId)
      .eq("organization_id", ORG_ID);
  }

  return NextResponse.json({ activity: data }, { status: 201 });
}
