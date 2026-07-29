/**
 * GET /api/contacts/[id]/thread
 *
 * Contact-mode feed for the ThreadPanel: the person's identity + every
 * communication with them, chronological. Used for stream rows whose
 * person has no lead yet (cold-outreach prospects, brokers, owners) —
 * the panel shows the conversation and the reply bar; the first send
 * creates a lead via /api/contacts/[id]/ensure-lead and hands off to the
 * normal lead send routes.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: contact, error } = await supabase
    .from("contacts")
    .select("id, full_name, email, phone, warmth, contact_type")
    .eq("organization_id", ORG_ID)
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: thread } = await supabase
    .from("communications")
    .select("id, direction, channel, subject, body_preview, from_address, occurred_at, lead_id")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", params.id)
    .order("occurred_at", { ascending: true })
    .limit(200);

  // If any message already hangs off a lead, surface the newest lead id so
  // the panel can upgrade itself to full lead mode (draft, lead file link).
  const leadId =
    [...((thread ?? []) as Array<{ lead_id: string | null }>)]
      .reverse()
      .find((m) => m.lead_id)?.lead_id ?? null;

  return NextResponse.json({ contact, thread: thread ?? [], leadId });
}
