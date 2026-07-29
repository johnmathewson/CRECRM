/**
 * POST /api/contacts/[id]/ensure-lead
 *
 * Returns a lead id for this contact, creating one if none exists — the
 * bridge that lets the ThreadPanel reply to contact-only people. All send
 * machinery (Gmail threading, SMS, drafts, Unanswered clearing) hangs off
 * a lead, so the first reply to a lead-less contact quietly creates the
 * conversation container and hands off to the normal routes.
 *
 * Created leads use source='other' + status='contacted': this is John
 * reaching OUT — it must never appear in the new-lead queue or trigger
 * auto-acks (those are first-touch-inbound only).
 *
 * Authenticated — an open endpoint would let anyone mint lead rows.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ORG_ID = "a0000000-0000-0000-0000-000000000001";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authSb = createServerSupabase();
  const { data: { user } } = await authSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, full_name, email, phone")
    .eq("organization_id", ORG_ID)
    .eq("id", params.id)
    .maybeSingle();
  if (!contact) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  // Reuse the newest open lead for this contact if one exists.
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contact.id)
    .not("status", "in", '("archived","spam")')
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ leadId: existing.id, created: false });
  }

  const { data: created, error } = await supabase
    .from("leads")
    .insert({
      organization_id: ORG_ID,
      contact_id: contact.id,
      source: "other",
      status: "contacted",
      sender_name: contact.full_name,
      sender_email: contact.email,
      sender_phone: contact.phone,
      raw_subject: `Outreach to ${contact.full_name ?? contact.email ?? contact.phone}`,
      urgency: "warm",
    })
    .select("id")
    .single();
  if (error || !created) {
    return NextResponse.json(
      { error: error?.message ?? "Lead insert failed" },
      { status: 500 }
    );
  }

  // Adopt any orphaned comms so the new lead's thread starts complete.
  await supabase
    .from("communications")
    .update({ lead_id: created.id })
    .eq("organization_id", ORG_ID)
    .eq("contact_id", contact.id)
    .is("lead_id", null);

  return NextResponse.json({ leadId: created.id, created: true });
}
