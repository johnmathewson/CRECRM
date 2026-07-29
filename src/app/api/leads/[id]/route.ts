/**
 * GET /api/leads/[id]   — full lead detail with property + contact + events + thread
 * PATCH /api/leads/[id] — update draft_reply, status, or notes (user actions)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = svc();
  const id = params.id;

  const { data: lead, error } = await supabase
    .from("leads")
    .select(`
      *,
      property:properties(id, name, headline, address, city, state, slug, asset_type, asking_price, lease_rate),
      contact:contacts(id, full_name, email, phone, warmth, contact_type, last_conversation)
    `)
    .eq("id", id)
    .eq("organization_id", ORG_ID)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Fetch events, the primary thread (by lead_id), and EVERY communication
  // with the same contact — regardless of which lead it's attached to.
  // One person = one conversation: duplicate-lead intake (e.g. repeat
  // questionnaire submissions minting a fresh lead per submission) used to
  // scatter a single relationship's messages across sibling lead files, so
  // the thread showed "unanswered" while the actual reply sat on a sibling.
  // The contact-wide fetch also covers the old orphan case (lead_id NULL).
  const [{ data: events }, { data: primaryThread }, orphanResult] = await Promise.all([
    supabase
      .from("lead_events")
      .select("*")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: true }),
    supabase
      .from("communications")
      .select("*")
      .eq("lead_id", id)
      .order("occurred_at", { ascending: true }),
    lead.contact_id
      ? supabase
          .from("communications")
          .select("*")
          .eq("organization_id", ORG_ID)
          .eq("contact_id", lead.contact_id)
          .order("occurred_at", { ascending: true })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);

  // Merge primary + orphaned comms, deduplicate by id, sort chronologically
  const seen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thread = [...(primaryThread ?? []), ...((orphanResult as any).data ?? [])]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((c: any) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

  return NextResponse.json({
    lead,
    events: events || [],
    thread,
  });
}

interface PatchBody {
  draft_reply?: string;
  status?: string;
  urgency?: "hot" | "warm" | "cold";
  notes?: string;
  property_id?: string | null;
  user_action?: "edit_draft" | "archive" | "reset_match" | "set_urgency";
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = svc();
  const id = params.id;

  const updates: Record<string, any> = {};
  if (body.draft_reply !== undefined) updates.draft_reply = body.draft_reply;
  if (body.status !== undefined) updates.status = body.status;
  if (body.urgency !== undefined) updates.urgency = body.urgency;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.property_id !== undefined) updates.property_id = body.property_id;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", id)
    .eq("organization_id", ORG_ID)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Record an event for user-driven actions
  if (body.user_action) {
    let eventType = "draft_edited";
    let summary = "Edited draft";
    if (body.user_action === "archive") {
      eventType = "archived";
      summary = "John archived this lead";
    } else if (body.user_action === "reset_match") {
      eventType = "matched_property";
      summary = body.property_id ? "John changed the property match" : "John cleared the property match";
    } else if (body.user_action === "set_urgency") {
      eventType = "draft_edited";
      summary = `John set urgency to ${body.urgency}`;
    }

    await supabase.from("lead_events").insert({
      organization_id: ORG_ID,
      lead_id: id,
      event_type: eventType,
      actor: "user",
      summary,
      metadata: { changes: updates },
    });
  }

  return NextResponse.json({ lead: data });
}
